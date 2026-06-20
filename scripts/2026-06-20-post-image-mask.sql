-- 主体视差效果：给帖子加「主体遮罩图」列。
-- 遮罩为灰度 PNG（主体≈白、背景≈黑），发帖时浏览器用 isnet-anime 现抠生成，
-- 与主图同桶（post-images），按 `_mask.png` 约定命名（见 lib/post-image-mask.ts）。
-- 仅单图帖、且发帖人勾选「3D 视差」时才会有值；其余为 NULL（前端不显示效果）。
-- 渲染端 components/subject-parallax 以本列为准；为空即回退普通 <img>。
alter table posts add column if not exists image_mask_url text;
