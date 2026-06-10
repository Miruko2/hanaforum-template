-- ============================================================
-- 放开 user_music_tracks.source 取值，新增 'tencent'（QQ音乐导入来源标记）- 2026-06-10
--
-- 背景：/music「我的音乐」新增 QQ音乐(y.qq.com) 歌单 / 单曲导入，沿用与网易云
--       同一条 Meting 公共解析通道（浏览器直连、服务器不碰字节、只存外链）。
--       导入的行用 source='tencent' 标记来源，便于日后统计 / 治理。
-- 原约束只允许 ('link','netease')，故需放开，否则 QQ 导入 INSERT 会被 CHECK 拒绝。
--
-- ⚠️ 必须先在 Supabase Dashboard → SQL Editor 整段跑一次，再上线前端；
--    否则用户点「QQ 导入」会报 check_violation。幂等，可重复执行。
-- ============================================================

ALTER TABLE public.user_music_tracks
  DROP CONSTRAINT IF EXISTS user_music_source_chk;

ALTER TABLE public.user_music_tracks
  ADD CONSTRAINT user_music_source_chk CHECK (source IN ('link', 'netease', 'tencent'));
