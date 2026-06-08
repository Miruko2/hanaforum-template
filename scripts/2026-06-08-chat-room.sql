-- ============================================================
-- 多人公共聊天室（公共大厅）消息表 chat_messages
-- 与弹幕墙 live_comments 分开存（两个独立的「地方」，互不串）。
-- 支持「文字」与「表情包」两种消息（kind）。
-- 在 Supabase → SQL Editor 整段执行（幂等，可重复跑）。
-- ============================================================

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  username   text not null,                 -- 冗余快照，避免 profiles 变动后消息失联
  avatar_url text,                            -- 发送时快照，渲染不必 join profiles
  kind       text not null default 'text' check (kind in ('text', 'sticker')),
  -- text：content 是文字内容
  -- sticker：content 是贴纸 id（如 'happy'，对应 public/hanako/stickers/happy.png）
  content    text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_created_at
  on public.chat_messages (created_at desc);

alter table public.chat_messages enable row level security;

-- 读：成员制聊天室，仅登录用户可读
drop policy if exists "chat_messages_read" on public.chat_messages;
create policy "chat_messages_read" on public.chat_messages
  for select using (auth.uid() is not null);

-- 写：只能发自己的，且过去 3 秒最多 3 条（反刷屏，照搬弹幕墙 RLS 思路）
drop policy if exists "chat_messages_insert_own" on public.chat_messages;
create policy "chat_messages_insert_own" on public.chat_messages
  for insert with check (
    auth.uid() = user_id
    and (
      select count(*) from public.chat_messages
      where user_id = auth.uid()
        and created_at > now() - interval '3 seconds'
    ) < 3
  );

-- 删：仅管理员
drop policy if exists "chat_messages_delete_admin" on public.chat_messages;
create policy "chat_messages_delete_admin" on public.chat_messages
  for delete using (
    exists (select 1 from public.admin_users where user_id = auth.uid())
  );

-- 打开 Realtime 推送（幂等：已加入则跳过，避免重复执行报错）
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

comment on table public.chat_messages is '多人公共聊天室（大厅），登录用户可发/可读，支持文字与表情包';
