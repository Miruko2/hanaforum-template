-- 防重口模式：给帖子加「敏感标记」列。
-- 管理员在帖子详情页一键标记后 is_nsfw=true，首页该帖封面不再展示真实图片，
-- 改为模糊背景 + 警告占位（components/post-card-image），点击仍可进详情页查看原图。
-- 默认 false，老帖与普通发帖流程不受影响（仅管理员通过 /api/admin/post-nsfw 写入）。
alter table posts add column if not exists is_nsfw boolean default false;
