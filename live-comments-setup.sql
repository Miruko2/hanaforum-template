-- ============================================================
-- 弹幕聊天墙 live_comments 表
-- 在 Supabase Dashboard → SQL Editor 里整段执行一次
-- ============================================================

-- 1. 建表
CREATE TABLE IF NOT EXISTS public.live_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  username TEXT NOT NULL,
  -- 冗余存一份用户名，避免聊天消息因 profiles 变动而失联
  content TEXT NOT NULL CHECK (char_length(content) > 0 AND char_length(content) <= 60),
  -- 前端也要做 60 字限制，这里再加一道约束兜底
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. 按时间倒序查询用的索引
CREATE INDEX IF NOT EXISTS idx_live_comments_created_at
  ON public.live_comments (created_at DESC);

-- 3. 启用 RLS
ALTER TABLE public.live_comments ENABLE ROW LEVEL SECURITY;

-- 4. 读权限：任何人（包括匿名）都能读。聊天墙本来就是公开的
DROP POLICY IF EXISTS "live_comments_read_all" ON public.live_comments;
CREATE POLICY "live_comments_read_all"
  ON public.live_comments
  FOR SELECT USING (true);

-- 5. 写权限：只有登录用户能发自己的弹幕，且过去 3 秒最多 2 条（反刷屏）
--    hanako 走 service-role 绕过 RLS，不受此限
DROP POLICY IF EXISTS "live_comments_insert_own" ON public.live_comments;
CREATE POLICY "live_comments_insert_own"
  ON public.live_comments
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      SELECT count(*) FROM public.live_comments
      WHERE user_id = auth.uid()
        AND created_at > now() - interval '3 seconds'
    ) < 2
  );

-- 6. 删权限：只允许管理员（参考现有 admin_users 表）
DROP POLICY IF EXISTS "live_comments_delete_admin" ON public.live_comments;
CREATE POLICY "live_comments_delete_admin"
  ON public.live_comments
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()
    )
  );

-- 7. 打开 Realtime（让前端的 .channel() 能收到变更推送）
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_comments;

-- 8. （可选）创建一个"只保留最近 N 条"的清理函数，定时调度
-- 这里不建 cron，前端只取最新 20 条就够了
COMMENT ON TABLE public.live_comments IS '全站弹幕聊天墙，任何登录用户可发，匿名可读';
