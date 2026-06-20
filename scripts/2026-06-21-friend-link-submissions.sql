-- 友链申请收集表 + 站内通知新增类型 friend_link_apply
-- ============================================================
-- 背景：/links 页新增「申请友链」表单 —— 访客填写自己网站信息（站名 / 网址 /
--   icon / 简介 / 联系方式）提交。提交统一走服务端 API（service_role 写入、绕 RLS），
--   不开放任何公开 INSERT，避免有人用 anon key 直刷本表；防刷（蜜罐 + 频率限制 +
--   字段校验）全在 API 层做。提交后：① 给管理员写一条 friend_link_apply 通知（铃铛）
--   ② 发一封邮件给管理员。是否真的收录仍由站长手动决定（往 page.tsx 的 FRIEND_SITES
--   数组加一行），本表只是「收件箱」。
--
-- 在 Supabase 控制台 → SQL Editor 里整段执行即可。幂等，可重复跑。
-- ============================================================

-- 1) 申请表
CREATE TABLE IF NOT EXISTS public.friend_link_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_name    text NOT NULL,
  site_url     text NOT NULL,
  icon_url     text,
  description  text,
  contact      text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected', 'spam')),
  submitter_ip text,            -- 仅作防刷 / 审计用；RLS 下只有管理员能读到
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fls_created_at ON public.friend_link_submissions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fls_status     ON public.friend_link_submissions (status);
CREATE INDEX IF NOT EXISTS idx_fls_ip_time    ON public.friend_link_submissions (submitter_ip, created_at);

-- 2) RLS：只有管理员能读 / 改；不开放任何公开读写。
--    写入一律走服务端 API（service_role 绕 RLS）—— 公开端拿不到 anon 直插权限，
--    故无 INSERT 策略 = 普通角色无法插入，刚好。
ALTER TABLE public.friend_link_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "友链申请仅管理员可读" ON public.friend_link_submissions;
CREATE POLICY "友链申请仅管理员可读" ON public.friend_link_submissions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "友链申请仅管理员可改" ON public.friend_link_submissions;
CREATE POLICY "友链申请仅管理员可改" ON public.friend_link_submissions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid())
  );

-- 3) notifications 表新增 friend_link_apply 类型（管理员收到「新友链申请」铃铛通知）。
--    下面两条 CHECK 完整复刻线上现有定义（已用只读 MCP 读取核对）+ 追加 friend_link_apply，
--    绝不丢任何旧类型（announcement / follow / chat_mention 等都保留）。
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'like_post', 'comment_post', 'like_comment', 'post_removed',
    'announcement', 'follow', 'chat_mention', 'friend_link_apply'
  ));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS valid_notification_type;
ALTER TABLE public.notifications
  ADD CONSTRAINT valid_notification_type CHECK (
    (type = 'like_post'    AND post_id IS NOT NULL AND comment_id IS NULL) OR
    (type = 'comment_post' AND post_id IS NOT NULL AND comment_id IS NULL) OR
    (type = 'like_comment' AND comment_id IS NOT NULL) OR
    (type = 'post_removed') OR
    (type = 'announcement' AND announcement_id IS NOT NULL) OR
    (type = 'follow'       AND post_id IS NULL AND comment_id IS NULL) OR
    (type = 'chat_mention' AND post_id IS NULL AND comment_id IS NULL) OR
    (type = 'friend_link_apply' AND post_id IS NULL AND comment_id IS NULL)
  );

-- 4) 自检：应看到上面两条 CHECK，且 friend_link_apply 在内。
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.notifications'::regclass AND contype = 'c'
ORDER BY conname;
