-- 为通知表新增"内容被移除"类型(post_removed)，用于图片审核后台删帖时通知用户。
--
-- 背景：
--   原 notifications 表只允许 like_post / comment_post / like_comment 三种类型，
--   且 post_id 外键是 ON DELETE CASCADE —— 一旦删帖，挂在该帖上的通知会被级联删掉。
--   因此审核移除通知(post_removed)特意【不挂 post_id】(帖子已被删)，
--   说明文字直接放在 message 里。
--
-- 在 Supabase 控制台 → SQL Editor 里整段执行即可。可重复执行(幂等)。

-- 1) 放开 type 列的取值约束，加入 post_removed
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('like_post', 'comment_post', 'like_comment', 'post_removed'));

-- 2) 放开组合约束：post_removed 允许 post_id / comment_id 都为空
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS valid_notification_type;
ALTER TABLE public.notifications
  ADD CONSTRAINT valid_notification_type CHECK (
    (type = 'like_post'    AND post_id IS NOT NULL AND comment_id IS NULL) OR
    (type = 'comment_post' AND post_id IS NOT NULL AND comment_id IS NULL) OR
    (type = 'like_comment' AND comment_id IS NOT NULL) OR
    (type = 'post_removed')
  );

-- 3) 自检：列出 notifications 表上现存的 CHECK 约束。
--    正常应只看到上面这两条(notifications_type_check / valid_notification_type)。
--    若之后插入 post_removed 仍报 "violates check constraint"，
--    说明线上还有个名字不同的旧约束没被 DROP，按这里列出的 conname 手动 DROP 即可。
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.notifications'::regclass
  AND contype = 'c';
