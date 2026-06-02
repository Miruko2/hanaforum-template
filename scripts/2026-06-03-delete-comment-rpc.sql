-- ============================================================
-- 评论删除 RPC - 2026-06-03
-- 需求：用户可删除自己发的评论；管理员可删除任何用户的评论。
--
-- 设计：与 delete_post 同款 SECURITY DEFINER 函数，在数据库端
--      校验权限（作者本人 OR admin_users 成员），前端按钮只负责
--      显隐，真正的授权在这里。这样无论 comments 表 RLS 如何配置
--      都能可靠工作，且管理员提权是受控的。
--
-- 级联：删一条评论时，连同它的所有子回复（递归）以及这些评论的
--      点赞一并删除，避免 getComments 把孤儿回复提升为顶级评论。
--
-- 跑这个脚本前请先在 Supabase Dashboard → Database → Backups 备份。
-- ============================================================

DROP FUNCTION IF EXISTS public.delete_comment(uuid);

CREATE OR REPLACE FUNCTION public.delete_comment(p_comment_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp  -- 防 search_path 攻击
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_admin boolean;
  v_is_author boolean;
  v_ids uuid[];
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION '未登录' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS(SELECT 1 FROM admin_users WHERE user_id = v_caller) INTO v_is_admin;
  SELECT EXISTS(SELECT 1 FROM comments WHERE id = p_comment_id AND user_id = v_caller) INTO v_is_author;

  IF NOT (v_is_admin OR v_is_author) THEN
    RAISE EXCEPTION '无权限删除此评论' USING ERRCODE = '42501';
  END IF;

  -- 收集该评论及其所有后代回复的 id（递归向下）
  WITH RECURSIVE descendants AS (
    SELECT id FROM comments WHERE id = p_comment_id
    UNION ALL
    SELECT c.id FROM comments c JOIN descendants d ON c.parent_id = d.id
  )
  SELECT array_agg(id) INTO v_ids FROM descendants;

  -- 操作日志（与 delete_post 保持一致）
  INSERT INTO operation_logs (
    operation_type, user_id, target_id, is_admin_operation, details
  ) VALUES (
    'delete_comment', v_caller, p_comment_id, v_is_admin,
    jsonb_build_object('comment_id', p_comment_id, 'deleted_ids', to_jsonb(v_ids), 'is_admin', v_is_admin)
  );

  -- 级联删除：先点赞，再评论本体（含所有后代回复）
  DELETE FROM comment_likes WHERE comment_id = ANY(v_ids);
  DELETE FROM comments WHERE id = ANY(v_ids);
END;
$$;

-- 只允许已登录用户调用（匿名会在函数内被 auth.uid() IS NULL 拦截，这里再加一层）
REVOKE ALL ON FUNCTION public.delete_comment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_comment(uuid) TO authenticated;
