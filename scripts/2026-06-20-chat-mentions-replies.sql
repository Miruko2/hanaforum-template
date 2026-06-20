-- 聊天 @提及 + 引用回复
-- ============================================================
-- 1) chat_messages / dm_messages 增加 reply_to 列（被引用消息的「快照」）
--    存 jsonb：{ id, senderId, name, excerpt, kind }。denormalized 快照而非外键——
--    渲染引用块时零 join、原消息被删也不影响展示，与现有 username/avatar_url 冗余快照一致。
-- 2) notifications 放开 type 约束，纳入 'chat_mention'（被@或被引用时给目标用户建一条通知，
--    自动点亮铃铛红点 + 触发顶部弹窗；与点赞/评论/关注共用一套通知系统）。
--    chat_mention 不挂 post/comment/announcement，只带 actor_id + message。
-- ============================================================

-- ── 1) reply_to 列 ──────────────────────────────────────────
alter table public.chat_messages
  add column if not exists reply_to jsonb;

alter table public.dm_messages
  add column if not exists reply_to jsonb;

-- ── 2) 通知类型扩展：新增 'chat_mention' ────────────────────
-- ⚠️ 必须保留既有所有类型，否则旧数据违反约束。
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('like_post', 'comment_post', 'like_comment', 'post_removed', 'announcement', 'follow', 'chat_mention'));

alter table public.notifications drop constraint if exists valid_notification_type;
alter table public.notifications
  add constraint valid_notification_type check (
    (type = 'like_post'    and post_id is not null and comment_id is null) or
    (type = 'comment_post' and post_id is not null and comment_id is null) or
    (type = 'like_comment' and comment_id is not null) or
    (type = 'post_removed') or
    (type = 'announcement' and announcement_id is not null) or
    (type = 'follow'        and post_id is null and comment_id is null) or
    (type = 'chat_mention'  and post_id is null and comment_id is null)
  );
