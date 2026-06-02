-- ============================================================
-- 全员公告广播功能
-- ------------------------------------------------------------
-- 目标：管理员在后台发一条公告 → 给所有现有用户各推送一条"系统通知"，
--   通知头像显示网站 logo，点击弹出磨砂玻璃弹窗看公告全文。
--
-- 设计：
--   - 公告正文存 announcements 表（唯一来源，便于查历史/管理）；
--   - notifications 新增 announcement_id 列，type 新增 'announcement'；
--   - 广播由 SECURITY DEFINER 函数 broadcast_announcement() 完成：
--       服务端校验 is_admin(auth.uid()) → 写 announcements → 一条 INSERT...SELECT
--       给 auth.users 里每个用户各插一行通知。前端无法伪造、非管理员调不动。
--   - 快照式：只推给"发送时刻已注册"的用户；之后注册的新用户看不到旧公告。
--
-- 在 Supabase 控制台 → SQL Editor 整段执行。幂等，可重复执行。
-- 依赖：public.is_admin(uuid)（见 2026-06-02-fix-admin-users-rls-recursion.sql）。
-- ============================================================

-- 1) 公告主体表
CREATE TABLE IF NOT EXISTS public.announcements (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  title      text        NOT NULL,
  content    text        NOT NULL,
  created_by uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 公告是公开广播内容，允许所有人读取（弹窗要读正文）。
-- 写入只走下面的 SECURITY DEFINER 函数，不向客户端开放 INSERT/UPDATE/DELETE。
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "公告所有人可读" ON public.announcements;
CREATE POLICY "公告所有人可读" ON public.announcements
  FOR SELECT USING (true);

-- 2) notifications 新增 announcement_id 列（删公告时级联清掉对应通知）
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS announcement_id uuid
  REFERENCES public.announcements(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_announcement_id
  ON public.notifications(announcement_id) WHERE announcement_id IS NOT NULL;

-- 3) 放开两个 CHECK 约束，纳入 'announcement'
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('like_post','comment_post','like_comment','post_removed','announcement'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS valid_notification_type;
ALTER TABLE public.notifications
  ADD CONSTRAINT valid_notification_type CHECK (
    (type = 'like_post'    AND post_id IS NOT NULL AND comment_id IS NULL) OR
    (type = 'comment_post' AND post_id IS NOT NULL AND comment_id IS NULL) OR
    (type = 'like_comment' AND comment_id IS NOT NULL) OR
    (type = 'post_removed') OR
    (type = 'announcement' AND announcement_id IS NOT NULL)
  );

-- 4) 广播函数：管理员调用，给所有用户扇出通知
CREATE OR REPLACE FUNCTION public.broadcast_announcement(p_title text, p_content text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  -- 鉴权：必须是登录的管理员（前端藏按钮不够，这里是真正的防线）
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION '只有管理员可以发布公告';
  END IF;

  -- 基本校验
  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION '公告标题不能为空';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION '公告内容不能为空';
  END IF;

  -- 写公告主体
  INSERT INTO public.announcements (title, content, created_by)
  VALUES (btrim(p_title), p_content, v_uid)
  RETURNING id INTO v_id;

  -- 扇出：给每个用户各插一行通知。
  -- message 直接存标题，通知卡片无需回查即可显示；正文点开弹窗时再按 announcement_id 取。
  INSERT INTO public.notifications (user_id, type, announcement_id, message, is_read, created_at)
  SELECT u.id, 'announcement', v_id, btrim(p_title), false, now()
  FROM auth.users u;

  RETURN v_id;
END;
$$;

-- 仅允许登录用户调用（函数内部再用 is_admin 二次校验）
REVOKE ALL ON FUNCTION public.broadcast_announcement(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.broadcast_announcement(text, text) TO authenticated;

-- 5) 自检：列出 notifications 上的 CHECK 约束，确认两条已就位
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.notifications'::regclass AND contype = 'c';
