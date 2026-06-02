-- ============================================================
-- 修复：admin_users RLS 策略无限递归 (42P17 infinite recursion)
-- ------------------------------------------------------------
-- 背景：2026-05-31 安全修复脚本里把 admin_users 的 SELECT 策略改成了
--   USING (auth.uid() IN (SELECT user_id FROM admin_users))
-- 这是自引用：评估策略要读 admin_users → 读表又触发同一策略 → 死循环。
-- 后果：任何 RLS 策略只要引用 admin_users（如 pinned_posts 的"管理员可管理"策略、
--   以及其它判管理员的表）都会连锁 500，置顶帖、通知等功能全挂。
--
-- 修法：用一个 SECURITY DEFINER 函数做"是否管理员"判定，
--   它以函数属主身份读表、不触发 RLS，从根上断开递归。
-- ============================================================

-- 1) 绕过 RLS 的管理员判定函数（内部读 admin_users 不再触发策略）
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = uid);
$$;

-- 2) 重写递归的 SELECT 策略：
--    - 普通登录用户：只能看到自己那一行（满足"我是不是管理员"的自查）；
--    - 管理员：能看到全部（满足后台管理页列出所有管理员）；
--    - 匿名用户：读不到（保持 2026-05-31"不再对匿名公开"的安全意图）。
--    两个分支都不再自引用 → 无递归。
DROP POLICY IF EXISTS "admin_users_select" ON public.admin_users;
CREATE POLICY "admin_users_select" ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- 3) 自检：确认新策略已生效、定义里不再出现自引用子查询
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'admin_users';
