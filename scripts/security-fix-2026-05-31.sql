-- ============================================================
-- 安全修复批次 - 2026-05-31
-- 起因：发现多个 SECURITY DEFINER 函数不做权限校验，
--      允许任何匿名用户提权 / 删帖 / 收割邮箱
-- 详见审计报告（claude session 2026-05-31）
--
-- 跑这个脚本前请先：
-- 1. Supabase Dashboard → Database → Backups 做一次手动备份
-- 2. 确认前端代码已同步更新（删除 delete_post 的 p_user_id 参数）
-- ============================================================

-- ─── 批次 1：删孤儿函数 / 视图（代码里没人用，最安全的修法）
DROP FUNCTION IF EXISTS public.add_initial_admin(uuid);
  -- ↑ CRIT-1：任何人调用这个能把自己变成 admin_users 里的一员

DROP FUNCTION IF EXISTS public.create_post(text,text,text,text,text,double precision,uuid);
  -- ↑ CRIT-2b：任何人能以任意 user_id 发帖（伪造）

DROP FUNCTION IF EXISTS public.delete_post_admin(uuid,uuid,boolean);
  -- ↑ CRIT-2c：同 delete_post 的问题，信任入参

DROP FUNCTION IF EXISTS public.get_posts_with_users();
  -- ↑ CRIT-3：邮箱收割机（返回所有用户的 email）

DROP VIEW IF EXISTS public.posts_with_users;
  -- ↑ CRIT-4：同上，视图层泄漏 user_email

DROP FUNCTION IF EXISTS public.add_admin_by_email(text);
DROP FUNCTION IF EXISTS public.search_user_by_email(text);
DROP FUNCTION IF EXISTS public.get_all_posts();
  -- ↑ H6：孤儿，占攻击面

-- ─── 批次 2：删 notifications 通杀 policy（CRIT-5）
DROP POLICY IF EXISTS "enable_all_access_notifications" ON public.notifications;

-- ─── 批次 3：收紧 RLS
-- H1：hanako_allowed_users 不再开放给客户端，只允许 service_role 操作
DROP POLICY IF EXISTS "Allow insert for authenticated" ON public.hanako_allowed_users;
DROP POLICY IF EXISTS "Allow delete for authenticated" ON public.hanako_allowed_users;
-- 注：read policy 保留（ai-reply 路由查白名单需要可读，
-- 实际是用 service_role 查，但 anon 可读也不构成安全问题，
-- 因为信息本身不敏感——只是 user_id 列表）

-- H3：admin_users 列表不再对匿名公开
DROP POLICY IF EXISTS "admin_users_select" ON public.admin_users;
CREATE POLICY "admin_users_select" ON public.admin_users
  FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM admin_users));

-- ─── 批次 4：重写 delete_post（CRIT-2a，唯一需要保留的危险函数）
-- 新签名：只接受 p_post_id，权限通过 auth.uid() 判断
DROP FUNCTION IF EXISTS public.delete_post(uuid, uuid);

CREATE OR REPLACE FUNCTION public.delete_post(p_post_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp  -- 防 search_path 攻击
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_is_author boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS(SELECT 1 FROM admin_users WHERE user_id = v_caller) INTO v_is_admin;
  SELECT EXISTS(SELECT 1 FROM posts WHERE id = p_post_id AND user_id = v_caller) INTO v_is_author;

  IF NOT (v_is_admin OR v_is_author) THEN
    RAISE EXCEPTION '无权限删除此帖子' USING ERRCODE = '42501';
  END IF;

  -- 操作日志（保留原逻辑）
  INSERT INTO operation_logs (
    operation_type, user_id, target_id, is_admin_operation, details
  ) VALUES (
    'delete_post', v_caller, p_post_id, v_is_admin,
    jsonb_build_object('post_id', p_post_id, 'is_admin', v_is_admin)
  );

  -- 级联删除
  DELETE FROM comments WHERE post_id = p_post_id;
  DELETE FROM likes WHERE post_id = p_post_id;
  DELETE FROM posts WHERE id = p_post_id;
END;
$$;

-- ============================================================
-- 不在本脚本范围（需另行评估）：
-- - public.users 表（带 password 列）：可能仍有外键依赖，先查后删
-- - public.admins 死表：同上
-- - 三个 storage bucket 的 file_size_limit：dashboard 改
-- - next.config.mjs 的 remotePatterns：代码侧修
-- ============================================================
