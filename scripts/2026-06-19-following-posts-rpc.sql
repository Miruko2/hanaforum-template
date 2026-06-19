-- ============================================================
-- 关注流排序 RPC - 2026-06-19
-- 需求：首页「关注」选项只看「我关注的人」发的帖，按时间倒序。
--      · 前端 filter 做不到干净分页（每页 30 条 filter 后可能只剩几条）；
--      · 两步查询（先查 following 列表再 .in()）要两次往返、且 OFFSET 分页不准；
--      故下沉到数据库端一次 JOIN + OFFSET/LIMIT —— 分页准确、一次往返、缓存可复用。
--
-- 设计：JOIN follows + posts —— follows.follower_id = 当前用户，
--      取其所有 following_id 对应的 posts，按 created_at 倒序。
--      follows 主键 (follower_id, following_id) 保证每个被关注者只出现一次
--      → JOIN 不会产生重复帖，无需 DISTINCT。
--      可选 p_category 过滤 → 「关注 + 分类」天然生效。
--      RETURNS SETOF posts → supabase-js 可对其 .select() 嵌套
--      likes(count)/comments(count)，与 getPostsPaginated / hot_posts 的
--      POST_SELECT 完全同构，前端处理链路零改动（见 lib/supabase-optimized.ts）。
--      SECURITY INVOKER（默认）：只读查询，照常走 posts / follows 表 RLS。
--
-- 索引（2026-06-19 EXPLAIN 实测均存在）：
--      · follows 侧 → idx_follows_follower (follower_id)     见 2026-06-11-follows.sql
--      · posts   侧 → idx_posts_user_id_created_at (user_id, created_at DESC)
--      两侧都有索引支撑，JOIN 成本只与「你关注的人发了多少帖」相关、与全表总量无关。
--
-- 安全：p_follower 由前端传当前 user.id。即便传入他人 id，也只能查到其关注者的
--      公开帖（posts RLS 仍逐行生效），无越权；「谁关注谁」本就是公开读。
--
-- ✅ 本文件是把线上「已部署」的 RPC 补录入库（此前只在 Supabase 后台、未进版本控制）。
--    函数体已用 pg_get_functiondef 与线上 2026-06-19 部署版本逐字核对一致（核对命令见文件末尾）。
--    （注：pg_get_functiondef 不含 GRANT，故下方授权按孪生函数 hot_posts 的惯例补齐。）
--    生产库已有此函数，平时无需重跑；本文件用于版本控制 / 重建库时恢复。
--    在 Supabase Dashboard → SQL Editor 整段执行（幂等，可重复跑）。
-- ============================================================

DROP FUNCTION IF EXISTS public.following_posts(uuid, integer, integer, text);

CREATE OR REPLACE FUNCTION public.following_posts(
  p_follower uuid,
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
  JOIN follows f ON f.following_id = p.user_id
  WHERE f.follower_id = p_follower
    AND (p_category IS NULL OR p.category = p_category)
  ORDER BY p.created_at DESC
  OFFSET GREATEST(p_offset, 0)
  LIMIT LEAST(GREATEST(p_limit, 1), 100);  -- 单次最多 100 条，防滥用
$$;

-- 与 hot_posts 一致放行 anon + authenticated（首页未登录也能浏览框架；
-- 「关注」虽是登录功能，前端已在 user.id 存在时才调用，anon 调到也只会拿到空集）。
REVOKE ALL ON FUNCTION public.following_posts(uuid, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.following_posts(uuid, integer, integer, text) TO anon, authenticated;

-- ── 核对：确认本文件与线上已部署版本一致 ──────────────────────────
-- 在 SQL Editor 跑下面这句，把输出的函数体与上面的 CREATE 比对；
-- 若不同（例如语言是 plpgsql、JOIN 写法不同、授权范围不同），以线上为准更新本文件：
--
--   select pg_get_functiondef(oid)
--   from pg_proc
--   where proname = 'following_posts' and pronamespace = 'public'::regnamespace;
