-- ============================================================
-- 关注关系表 follows —— 社交个人页第 4 步（关注 / 粉丝）。2026-06-11
--
-- 一行 = 「follower_id 关注了 following_id」。两列联合主键天然去重（不能重复关注）。
-- RLS：
--   · 读：公开（任何登录用户都能看谁关注了谁 → 用于算粉丝/关注数、判断「我是否已关注」）。
--   · 写(insert)：只能以自己身份关注别人，且不能关注自己。
--   · 删(unfollow)：只能删自己发起的关注。
--
-- 关注计数不另建计数列（避免触发器维护、并发漂移）；前端按需 count(*) 即可，
-- 量级小、有索引，足够。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行（幂等，可重复跑）。
-- ============================================================

create table if not exists public.follows (
  follower_id  uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

-- 反查「某人的粉丝列表 / 粉丝数」用（following_id 维度）
create index if not exists idx_follows_following on public.follows (following_id);
-- 正查「某人关注了谁 / 关注数」用（follower_id 维度）
create index if not exists idx_follows_follower on public.follows (follower_id);

alter table public.follows enable row level security;

-- 读：公开（算计数、判断关注态）
drop policy if exists "follows_select_all" on public.follows;
create policy "follows_select_all" on public.follows
  for select using (true);

-- 写：只能以自己身份关注别人（check 里再挡一次自关注，与表约束双保险）
drop policy if exists "follows_insert_own" on public.follows;
create policy "follows_insert_own" on public.follows
  for insert with check (auth.uid() = follower_id and follower_id <> following_id);

-- 删：只能取消自己发起的关注
drop policy if exists "follows_delete_own" on public.follows;
create policy "follows_delete_own" on public.follows
  for delete using (auth.uid() = follower_id);

comment on table public.follows is '关注关系：follower_id 关注 following_id；RLS 公开读、仅本人写/删';

-- ── 通知类型扩展：新增 'follow'（被关注通知）。follow 不挂 post/comment ──
-- 与既有 notifications 表对齐：放开 type 与组合约束，纳入 follow。
-- ⚠️ 必须保留 'announcement'（公告广播已写入大量该类型的行），否则旧数据违反约束。
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('like_post', 'comment_post', 'like_comment', 'post_removed', 'announcement', 'follow'));

alter table public.notifications drop constraint if exists valid_notification_type;
alter table public.notifications
  add constraint valid_notification_type check (
    (type = 'like_post'    and post_id is not null and comment_id is null) or
    (type = 'comment_post' and post_id is not null and comment_id is null) or
    (type = 'like_comment' and comment_id is not null) or
    (type = 'post_removed') or
    (type = 'announcement' and announcement_id is not null) or
    (type = 'follow'        and post_id is null and comment_id is null)
  );
