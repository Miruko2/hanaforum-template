-- ============================================================
-- 热度排序 RPC - 2026-06-13
-- 需求：首页「热度」选项需要全库真热度排序。前端排序只能排已
--      加载的帖子，最热的帖子若在后面几页就排不上来。
--
-- 设计：热度分 = 点赞数×2 + 评论数×3，同分按时间新的在前。
--      RETURNS SETOF posts → supabase-js 可对其 .select() 嵌套
--      likes(count)/comments(count)，与 getPostsPaginated 的
--      POST_SELECT 完全同构，前端处理链路零改动。
--      SECURITY INVOKER（默认）：只读查询，照常走 posts 表 RLS。
-- ============================================================

DROP FUNCTION IF EXISTS public.hot_posts(integer, integer, text);

CREATE OR REPLACE FUNCTION public.hot_posts(
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 30,
  p_category text DEFAULT NULL
)
  RETURNS SETOF public.posts
  LANGUAGE sql
  STABLE
  SET search_path = public, pg_temp
AS $$
  SELECT p.*
  FROM posts p
  LEFT JOIN (
    SELECT post_id, count(*) AS cnt FROM likes GROUP BY post_id
  ) l ON l.post_id = p.id
  LEFT JOIN (
    SELECT post_id, count(*) AS cnt FROM comments GROUP BY post_id
  ) c ON c.post_id = p.id
  WHERE p_category IS NULL OR p.category = p_category
  ORDER BY COALESCE(l.cnt, 0) * 2 + COALESCE(c.cnt, 0) * 3 DESC,
           p.created_at DESC
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 100);  -- 限制单次最多100条，防滥用
$$;

-- 首页未登录也能浏览，anon 和 authenticated 都放行
REVOKE ALL ON FUNCTION public.hot_posts(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hot_posts(integer, integer, text) TO anon, authenticated;
