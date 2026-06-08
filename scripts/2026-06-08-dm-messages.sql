-- ============================================================
-- 私聊（1对1 DM）消息表 dm_messages
-- pair_key = 双方 user_id 排序后用 ":" 连接 → 一对会话的双向消息共享同一个键，
-- 方便按会话拉取。RLS 限定「仅会话双方可见」。
-- 在 Supabase → SQL Editor 整段执行（幂等，可重复跑）。
-- ============================================================

create table if not exists public.dm_messages (
  id           uuid primary key default gen_random_uuid(),
  pair_key     text not null,                 -- 排序后的 "uidA:uidB"
  sender_id    uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind         text not null default 'text' check (kind in ('text', 'sticker')),
  content      text not null check (char_length(content) between 1 and 500),
  created_at   timestamptz not null default now()
);

create index if not exists idx_dm_pair_created on public.dm_messages (pair_key, created_at);
create index if not exists idx_dm_recipient_created on public.dm_messages (recipient_id, created_at);

alter table public.dm_messages enable row level security;

-- 读：只能看自己参与的会话（发送方或接收方）
drop policy if exists "dm_select_own" on public.dm_messages;
create policy "dm_select_own" on public.dm_messages
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- 写：只能以自己身份发，且过去 3 秒最多 3 条
drop policy if exists "dm_insert_own" on public.dm_messages;
create policy "dm_insert_own" on public.dm_messages
  for insert with check (
    auth.uid() = sender_id
    and (
      select count(*) from public.dm_messages
      where sender_id = auth.uid()
        and created_at > now() - interval '3 seconds'
    ) < 3
  );

-- 删：仅管理员
drop policy if exists "dm_delete_admin" on public.dm_messages;
create policy "dm_delete_admin" on public.dm_messages
  for delete using (
    exists (select 1 from public.admin_users where user_id = auth.uid())
  );

-- Realtime 推送（幂等）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dm_messages'
  ) then
    alter publication supabase_realtime add table public.dm_messages;
  end if;
end $$;

comment on table public.dm_messages is '1对1 私聊消息；pair_key 为排序后的双方 id，RLS 限定仅双方可见';
