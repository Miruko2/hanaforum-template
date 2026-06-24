-- 2026-06-24  论坛「收藏」功能 (post collections / bookmarks)
-- 设计：完整镜像现有 likes 表的成熟模式（每行 = 某用户收藏某帖）。
-- 隐私：私密 —— 仅本人可读、仅本人可增删自己那条（与 likes 的「公开读」不同，这是关键差异）。
-- 注意：本项目惯例是手动在 Supabase SQL Editor 跑脚本（MCP 只读）。请先跑本脚本再部署前端。

create table if not exists public.collections (
  id          uuid default extensions.uuid_generate_v4() not null primary key,
  user_id     uuid,
  -- 外键 + 级联删除：帖子被删时自动清理对应收藏（不留孤儿行）；
  -- 同时让 PostgREST 能用一条查询把收藏直接带出帖子信息（嵌入 posts(*)）。
  post_id     uuid references public.posts(id) on delete cascade,
  created_at  timestamptz default now()
);

-- 防止重复收藏同一帖（前端 insert 走 ON CONFLICT DO NOTHING）
create unique index if not exists collections_user_post_unique
  on public.collections using btree (user_id, post_id);

-- 「列出我的收藏」「数某帖被收藏数」走索引
create index if not exists idx_collections_user_id on public.collections using btree (user_id);
create index if not exists idx_collections_post_id on public.collections using btree (post_id);

alter table public.collections enable row level security;

-- 私密策略：仅本人可读 / 仅本人可增删自己那条
drop policy if exists collections_select on public.collections;
create policy collections_select on public.collections
  for select using (auth.uid() = user_id);

drop policy if exists collections_insert on public.collections;
create policy collections_insert on public.collections
  for insert with check (auth.uid() = user_id);

drop policy if exists collections_delete on public.collections;
create policy collections_delete on public.collections
  for delete using (auth.uid() = user_id);

-- 授权：私密 —— 仅 authenticated 角色，匿名无权（RLS 也已兜底，这里再从 grant 层显式收紧）
revoke all on public.collections from anon;
grant select, insert, delete on public.collections to authenticated;
