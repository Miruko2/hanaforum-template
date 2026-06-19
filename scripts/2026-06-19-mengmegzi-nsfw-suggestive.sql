-- ============================================================
-- 萌萌子 Agent：色图(nsfw)分类开启「软色情·不露点」配图
-- 在 Supabase → SQL Editor 执行一次。仅改数据、不改表结构。
--
-- 背景：色图分类原 provider "none"（不配图、萌萌子只发文字贴）。改为 provider "suggestive"：
--   · 双源聚合：danbooru rating:s（sensitive=性感但定义上不露点，安全锚）
--                + yande.re rating:q（更辣，靠黑名单兜「不露点」）
--   · 放行 swimsuit/bikini/lingerie/cleavage 等性感 tag（这正是「性感不露点」要的内容）
--   · 代码侧硬拦：SUGGESTIVE_EXTRA_BLOCK（露点/性行为 tag）+ BOORU_TAG_BLOCKLIST
--     （loli/shota/guro 等绝对红线，任何分类都拦）。见 lib/mengmegzi/constants.ts +
--     image-sources.fetchFromSuggestiveBooruSources。
--   · query "swimsuit" = AI 关键词搜不到时的回退 tag（必出性感不露点图）。
--
-- 只动 nsfw 一项，其余分类（general/game/life/code/help）保持原样。
-- 回滚：把 nsfw 改回 {"provider": "none"} 即可。
-- ============================================================

update public.mengmegzi_config
set image_sources = jsonb_set(
      coalesce(image_sources, '{}'::jsonb),
      '{nsfw}',
      '{"provider": "suggestive", "query": "swimsuit"}'::jsonb,
      true
    ),
    updated_at = now()
where id = 1;

-- 核对结果：
-- select image_sources -> 'nsfw' from public.mengmegzi_config where id = 1;
