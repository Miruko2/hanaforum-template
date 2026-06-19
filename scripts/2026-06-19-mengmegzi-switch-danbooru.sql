-- ============================================================
-- 萌萌子 Agent：配图源切换到 danbooru（二次元动漫图）
-- 在 Supabase → SQL Editor 执行一次。仅改数据、不改表结构。
--
-- 背景：原 unsplash 配真实照片，二次元论坛违和。改用 danbooru 动漫图：
--   · AI 发帖时吐的 image_query 转 tag 搜，搜不到回退下面 query 字段的 booru tag
--   · 代码侧强制 rating:g（最严级别）+ tag 黑名单二次过滤（见 lib/mengmegzi/constants.ts
--     的 BOORU_TAG_BLOCKLIST 与 image-sources.fetchFromDanbooru）
-- nsfw/code/help 保持 none（不配图）。
-- 回滚：把 provider 改回 "unsplash"、query 改回英文搜索词即可。
-- ============================================================

update public.mengmegzi_config
set image_sources = '{
  "general": {"provider": "danbooru", "query": "original"},
  "nsfw":    {"provider": "none"},
  "game":    {"provider": "danbooru", "query": "video_game"},
  "code":    {"provider": "none"},
  "life":    {"provider": "danbooru", "query": "scenery"},
  "help":    {"provider": "none"}
}'::jsonb,
    updated_at = now()
where id = 1;
