-- ============================================================
-- 用户封禁 banned_users - 2026-06-15
--
-- 作用：管理员封禁辱骂/违规用户后，该账号被**全站锁定**（账号级，非 IP）：
--      前端 App 层门禁（BannedGate）整屏接管 + 数据层禁止任何写入。
--      不是 IP —— 公开站点上封号挡不住对方登出后匿名浏览，而 IP 封禁误伤
--      CGNAT 共享出口、且本架构客户端直连 Supabase 拿不到真实 IP，故走账号级。
--
-- 本脚本（数据层）三块：
--   1. banned_users 表（user_id 主键，reason / expires_at[NULL=永久]）+ RLS + realtime；
--   2. is_banned(uid) 函数：SECURITY DEFINER，统一判定“是否处于有效封禁中”；
--   3. 写入拦截：弹幕走 live_comments 写策略加 NOT is_banned；其余用户可写「基表」
--      （posts/comments/likes/comment_likes/dm_messages/chat_messages/
--       user_music_tracks/profiles）用 block_banned_write() 触发器拦 —— 触发器对
--      “客户端直连”和“SECURITY DEFINER RPC（发帖/评论）”写入都生效；视图（如
--      user_profiles）自动跳过，其写入最终落到 profiles 基表，已被覆盖。
--   （App 层门禁在前端代码：contexts/auth-context-simple.tsx + components/banned-gate.tsx）
--
-- RLS：
--   - 管理员（admin_users 表内）可读写全部封禁记录；
--   - 普通用户只能 SELECT 自己的封禁记录（前端门禁/提示据此，且 realtime 即时生效）；
--   - hanako / 审核函数 / 管理员后台走 service-role（auth.uid()=NULL），绕过 RLS 与触发器，不受影响。
--
-- 在 Supabase Dashboard → SQL Editor 里整段执行一次（幂等，可重复跑）。
-- ============================================================

-- 1) 封禁表
CREATE TABLE IF NOT EXISTS public.banned_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reason     TEXT,
  banned_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = 永久封禁；设了时间 = 到期自动解封（由 is_banned 判定，无需 cron）
  expires_at TIMESTAMPTZ
);

COMMENT ON TABLE public.banned_users IS '被封禁用户（账号级）。is_banned() 判定有效性，live_comments 写策略据此拦截。';

-- 2) 启用 RLS
ALTER TABLE public.banned_users ENABLE ROW LEVEL SECURITY;

-- 2a) 管理员可读写全部
DROP POLICY IF EXISTS banned_users_admin_all ON public.banned_users;
CREATE POLICY banned_users_admin_all ON public.banned_users
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

-- 2b) 普通用户只能看自己的封禁记录（前端据此提示/门禁，不暴露别人是否被封）
DROP POLICY IF EXISTS banned_users_select_self ON public.banned_users;
CREATE POLICY banned_users_select_self ON public.banned_users
  FOR SELECT
  USING (auth.uid() = user_id);

-- 2c) 打开 Realtime：前端订阅自己的封禁行变更，封禁/解封即时生效（无需刷新）。
--     realtime 同样受 RLS 约束，select-self 保证用户只能收到自己那行的变更。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'banned_users'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.banned_users;
  END IF;
END $$;

-- 3) is_banned 判定函数
--    SECURITY DEFINER：以函数属主（超级角色）身份读 banned_users，
--    不受调用者 RLS 限制，便于在任意表的写策略里复用而不暴露整张表。
--    SET search_path = public：固定搜索路径，防 search_path 劫持。
CREATE OR REPLACE FUNCTION public.is_banned(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.banned_users
    WHERE user_id = uid
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;

-- RLS 策略表达式由调用者角色执行，需要其对该函数有 EXECUTE 权限
GRANT EXECUTE ON FUNCTION public.is_banned(UUID) TO authenticated, anon;

-- 4) 修改 live_comments 写策略：在原策略上叠加“未被封禁”
--    （保留原“本人 + 3 秒内最多 2 条”限流不变）
DROP POLICY IF EXISTS "live_comments_insert_own" ON public.live_comments;
CREATE POLICY "live_comments_insert_own"
  ON public.live_comments
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND NOT public.is_banned(auth.uid())
    AND (
      SELECT count(*) FROM public.live_comments
      WHERE user_id = auth.uid()
        AND created_at > now() - interval '3 seconds'
    ) < 2
  );

COMMENT ON POLICY "live_comments_insert_own" ON public.live_comments IS
  '登录用户写自己的弹幕，未被封禁，且每 3 秒最多 2 条（反刷屏）';

-- ============================================================
-- 5) 全站写入封禁：BEFORE 触发器
--    为何用触发器而非给每张表的 RLS 加条件：发帖/评论走 SECURITY DEFINER RPC
--    （create_post / add_comment / like_post …），会**绕过表 RLS**；而 auth.uid()
--    在 SECURITY DEFINER 内部仍返回真实调用者，所以触发器对「客户端直连写入」和
--    「RPC 写入」都能拦截。service_role（auth.uid() 为 NULL）不受影响 —— hanako 写弹幕、
--    审核函数删内容、管理员后台操作照常工作。非封禁用户 is_banned()=false、触发器直接放行，
--    对正常写入零影响。
CREATE OR REPLACE FUNCTION public.block_banned_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_banned(auth.uid()) THEN
    RAISE EXCEPTION '账号已被封禁，禁止操作' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 给各「用户可写」基表挂触发器。用 DO 块按 relkind='r' 过滤，自动跳过视图：
-- 例如 user_profiles 是 profiles 上的视图（视图不能挂行级触发器），而资料
-- 改名/换头像实际写的是 profiles 基表（见 lib/profiles.ts），由下面 profiles 的
-- 触发器覆盖。live_comments 已由其 INSERT 策略接管，此处不重复挂。
-- 幂等：先 DROP 再建。
DO $$
DECLARE
  t text;
  trig text;
  -- 仅拦 INSERT 的表（内容创建类滥用）
  insert_only text[] := ARRAY[
    'posts', 'comments', 'likes', 'comment_likes',
    'dm_messages', 'chat_messages', 'user_music_tracks'
  ];
BEGIN
  FOREACH t IN ARRAY insert_only LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      -- 触发器名整体拼好再用 %I 引用（不能把表名单独塞进 %I）
      trig := 'trg_block_banned_' || t;
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trig, t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION public.block_banned_write()', trig, t);
    ELSE
      RAISE NOTICE 'skip trg_block_banned_%: public.% 不是基表（视图或不存在）', t, t;
    END IF;
  END LOOP;

  -- profiles：改名/换头像是 UPDATE 型滥用，额外拦 UPDATE
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'profiles' AND c.relkind = 'r'
  ) THEN
    DROP TRIGGER IF EXISTS trg_block_banned_profiles ON public.profiles;
    CREATE TRIGGER trg_block_banned_profiles
      BEFORE INSERT OR UPDATE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.block_banned_write();
  ELSE
    RAISE NOTICE 'skip trg_block_banned_profiles: public.profiles 不是基表（视图或不存在）';
  END IF;
END $$;

-- ============================================================
-- 回滚（如需还原到无封禁状态）：
--   -- 1. 卸触发器
--   DROP TRIGGER IF EXISTS trg_block_banned_posts ON public.posts;
--   DROP TRIGGER IF EXISTS trg_block_banned_comments ON public.comments;
--   DROP TRIGGER IF EXISTS trg_block_banned_likes ON public.likes;
--   DROP TRIGGER IF EXISTS trg_block_banned_comment_likes ON public.comment_likes;
--   DROP TRIGGER IF EXISTS trg_block_banned_dm ON public.dm_messages;
--   DROP TRIGGER IF EXISTS trg_block_banned_chat ON public.chat_messages;
--   DROP TRIGGER IF EXISTS trg_block_banned_music ON public.user_music_tracks;
--   DROP TRIGGER IF EXISTS trg_block_banned_profiles ON public.profiles;
--   DROP FUNCTION IF EXISTS public.block_banned_write();
--   -- 2. 还原弹幕墙写策略（去掉 NOT is_banned）
--   DROP POLICY IF EXISTS "live_comments_insert_own" ON public.live_comments;
--   CREATE POLICY "live_comments_insert_own" ON public.live_comments
--     FOR INSERT WITH CHECK (
--       auth.uid() = user_id
--       AND (SELECT count(*) FROM public.live_comments
--            WHERE user_id = auth.uid()
--              AND created_at > now() - interval '3 seconds') < 2
--     );
--   -- 3. 卸函数与表
--   DROP FUNCTION IF EXISTS public.is_banned(UUID);
--   DROP TABLE IF EXISTS public.banned_users;
-- ============================================================
