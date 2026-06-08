-- ============================================================
-- 每用户自定义音乐墙（只存直链，不托管音频字节）- 2026-06-03
-- 配套：/music 页「我的音乐」编辑器 + 网易链接解析入口
--
-- 设计要点（与版权/负载/防 ban 直接相关）：
--   · 只存「链接」：audio_url / cover_url 都是用户/解析得到的外链；
--     播放时由听众浏览器直连，我们服务器不下载、不转存、不代理字节。
--   · 完美按 user_id 分区：每人只查自己 ≤100 行，无跨用户聚合、无扇出。
--   · RLS 锁死：普通用户只能读写自己的行。
--   · CHECK 约束：只收 https、限长度，挡 javascript:/data:/明文 http、防字段膨胀。
--   · 触发器限每用户曲目上限（防脚本刷库）。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行一次（幂等，可重复跑）。
-- ============================================================

-- 1) 主表
CREATE TABLE IF NOT EXISTS public.user_music_tracks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  artist     TEXT NOT NULL DEFAULT '',
  cover_url  TEXT NOT NULL DEFAULT '',
  audio_url  TEXT NOT NULL,
  sort_index INT  NOT NULL DEFAULT 0,
  -- 来源标记：'link' = 用户自带直链；'netease' = 经网易解析入口导入。便于日后统计/治理。
  source     TEXT NOT NULL DEFAULT 'link',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ---- 安全 / 防滥用约束 ----
  CONSTRAINT user_music_title_len  CHECK (char_length(title)     <= 200),
  CONSTRAINT user_music_artist_len CHECK (char_length(artist)    <= 200),
  CONSTRAINT user_music_audio_len  CHECK (char_length(audio_url) <= 2048),
  CONSTRAINT user_music_cover_len  CHECK (char_length(cover_url) <= 2048),
  -- 只允许 https（挡 javascript:/data:/明文 http；防 XSS 与不安全混合内容）
  CONSTRAINT user_music_audio_https CHECK (audio_url ~* '^https://'),
  CONSTRAINT user_music_cover_https CHECK (cover_url = '' OR cover_url ~* '^https://'),
  CONSTRAINT user_music_source_chk  CHECK (source IN ('link', 'netease'))
);

-- 2) 索引：单用户按 sort_index 取自己那几十行，永远只扫自己分区
CREATE INDEX IF NOT EXISTS user_music_tracks_user_sort_idx
  ON public.user_music_tracks (user_id, sort_index);

-- 3) 每用户曲目上限（防刷库）。插入前计数，超限直接拒绝。
--    想调上限改这里的 50 即可。
CREATE OR REPLACE FUNCTION public.enforce_user_music_track_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  cnt INT;
BEGIN
  SELECT count(*) INTO cnt
  FROM public.user_music_tracks
  WHERE user_id = NEW.user_id;

  IF cnt >= 100 THEN
    RAISE EXCEPTION '每个用户最多 100 首自定义曲目'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_user_music_track_cap ON public.user_music_tracks;
CREATE TRIGGER trg_user_music_track_cap
  BEFORE INSERT ON public.user_music_tracks
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_user_music_track_cap();

-- 4) RLS：只有本人能读写自己的曲目。
--    （Edge Function/service_role 如需治理可绕过 RLS，与此不冲突。）
ALTER TABLE public.user_music_tracks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_music_tracks_owner_all ON public.user_music_tracks;
CREATE POLICY user_music_tracks_owner_all ON public.user_music_tracks
  FOR ALL
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE public.user_music_tracks IS
  '每用户自定义音乐墙（只存外链，不托管字节）。RLS：仅本人可读写。';

-- ============================================================
-- 拖拽排序说明：MVP 用逐行 UPDATE sort_index（RLS 允许本人改）。
-- 若以后要原子化批量重排，可再加一个 SECURITY DEFINER RPC，
-- 这里先不做，避免过度设计。
-- ============================================================
