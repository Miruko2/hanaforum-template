-- ============================================================
-- 管理面板「曾参与用户数」(真实活跃口径) - 2026-06-21
-- 配套：app/api/admin/engaged-count、app/admin/page.tsx 用户 tab
--
-- 背景：原打算在后台显示「已验证邮箱数」，但邮箱验证 gate 长期关闭 + 老用户
--      豁免 + 超额兜底假标记，使该数毫无意义(实测 1992 注册仅 26)。改用
--      「曾发帖/评论/弹幕/私信/聊天的去重用户数」衡量真实参与用户(实测 374)。
--
-- 为什么需要这个函数：跨 5 张内容表对用户去重计数，PostgREST 做不到(只能数行、
--      不能跨表 distinct)；纯前端拉 id 去重会超 1000 行上限且浪费 egress。故用
--      一个只读聚合函数，返回单个整数。
--
-- 安全：
--   - 只读(STABLE，无任何写)，仅返回一个计数，不泄露任何行内容。
--   - 执行权限收回 public/anon/authenticated，仅 service_role 可调用；
--     线上只在 /api/admin/engaged-count 内、requireAdmin 通过后由后台调用。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行一次(幂等，可重复跑)。
-- ============================================================

CREATE OR REPLACE FUNCTION public.count_engaged_users()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT count(*)::int FROM (
    SELECT user_id   FROM public.posts         WHERE user_id   IS NOT NULL
    UNION
    SELECT user_id   FROM public.comments      WHERE user_id   IS NOT NULL
    UNION
    SELECT user_id   FROM public.live_comments WHERE user_id   IS NOT NULL
    UNION
    SELECT sender_id FROM public.dm_messages   WHERE sender_id IS NOT NULL
    UNION
    SELECT user_id   FROM public.chat_messages WHERE user_id   IS NOT NULL
  ) AS u;
$$;

COMMENT ON FUNCTION public.count_engaged_users() IS
  '后台统计：曾发帖/评论/弹幕/私信/聊天的去重用户数(真实参与用户)。只读，仅 service_role 可执行。';

-- 锁权限：默认函数 PUBLIC 可执行，这里收回，只留后台 service_role
REVOKE ALL ON FUNCTION public.count_engaged_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.count_engaged_users() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_engaged_users() TO service_role;

-- 验证(可选)：应返回与下方一致的数字
--   SELECT public.count_engaged_users();
-- ============================================================
