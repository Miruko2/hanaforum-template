-- ============================================================
-- 回滚脚本 - 2026-05-31
-- 用途：如果 security-fix-2026-05-31.sql 跑出问题，用这个脚本恢复
--      （恢复的是 schema/代码层面，不涉及数据）
--
-- 注意：DROP 掉的孤儿函数不做恢复，因为：
--   1. 那些函数本身就是漏洞，恢复 = 重新暴露漏洞
--   2. 代码里没人用，恢复也无意义
-- 只回滚两个"可能影响正常功能"的变更：
--   - delete_post 函数（保证 /admin 删帖功能可用）
--   - admin_users_select policy（保证管理页能列管理员）
-- ============================================================

-- ─── 回滚 delete_post 到原始签名/逻辑 ─────────────────
-- 警告：这会重新打开 CRIT-2a 漏洞（信任客户端传入 user_id）
-- 仅在确认新版本有问题时使用，并尽快二次修复
DROP FUNCTION IF EXISTS public.delete_post(uuid);

CREATE OR REPLACE FUNCTION public.delete_post(p_post_id uuid, p_user_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_post_exists BOOLEAN;
  v_is_author BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = p_user_id
  ) INTO v_is_admin;

  INSERT INTO operation_logs (
    operation_type, user_id, target_id, is_admin_operation, details
  ) VALUES (
    'delete_post', p_user_id, p_post_id, v_is_admin,
    jsonb_build_object('post_id', p_post_id, 'user_id', p_user_id, 'is_admin', v_is_admin)
  );

  SELECT EXISTS (SELECT 1 FROM posts WHERE id = p_post_id) INTO v_post_exists;
  IF NOT v_post_exists THEN
    RAISE EXCEPTION '帖子不存在';
  END IF;

  SELECT EXISTS (SELECT 1 FROM posts WHERE id = p_post_id AND user_id = p_user_id) INTO v_is_author;

  IF v_is_admin OR v_is_author THEN
    DELETE FROM comments WHERE post_id = p_post_id;
    DELETE FROM likes WHERE post_id = p_post_id;
    DELETE FROM posts WHERE id = p_post_id;
  ELSE
    RAISE EXCEPTION '没有权限删除此帖子';
  END IF;
END;
$$;

-- ─── 回滚 admin_users SELECT policy 到"全开" ─────────
-- 警告：这会重新打开 H3 信息泄漏（任何人能查管理员列表）
DROP POLICY IF EXISTS "admin_users_select" ON public.admin_users;
CREATE POLICY "admin_users_select" ON public.admin_users
  FOR SELECT
  USING (true);
