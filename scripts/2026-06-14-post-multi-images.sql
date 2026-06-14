-- ============================================================
-- 帖子多图支持 - 2026-06-14
--
-- 需求：发帖可上传多张图片，第一张作封面，详情页左右滑动浏览。
--
-- 设计：新增 image_urls text[] 列，按上传顺序存「全部图片」的 public URL，
--      第一张即封面。为最大化向后兼容，保留 image_url 作为「封面 = 第一张」
--      —— 列表卡片缩略图、hero 飞入转场、图片审核(moderate-image)、孤儿图
--      清理脚本都仍以 image_url 为准，单图老帖零改动。
--
--      hot_posts RPC 返回 SETOF posts、内部用 p.*，新增列自动带出，RPC 无需改。
--      前端各查询的 select 串需显式加 image_urls（见 lib/supabase*.ts）。
--
-- 幂等：IF NOT EXISTS，可安全重复执行。
-- ============================================================

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS image_urls text[];

COMMENT ON COLUMN public.posts.image_urls IS
  '帖子全部图片的 public URL（按上传顺序，第一张为封面，与 image_url 一致）。单图老帖此列为 NULL，前端回退按 [image_url] 处理。';
