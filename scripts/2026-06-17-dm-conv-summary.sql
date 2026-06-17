-- ============================================================
-- 萌萌子私信：会话摘要表 dm_conv_summary
-- 超出上下文窗口的旧消息被压缩成摘要，保留长期记忆。
-- 仅 service_role 可读写（RLS 开启、无 policy）。
-- 在 Supabase → SQL Editor 整段执行（幂等，可重复跑）。
-- ============================================================

create table if not exists public.dm_conv_summary (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  summary           text not null default '',            -- 已压缩的旧对话摘要
  summarized_up_to  timestamptz not null default now(),  -- 摘要覆盖到哪条消息的 created_at（之后的消息尚未摘要）
  updated_at        timestamptz not null default now()
);

alter table public.dm_conv_summary enable row level security;  -- 无 policy → 仅 service_role

comment on table public.dm_conv_summary is '萌萌子私信会话摘要:超出上下文窗口的旧消息压缩成摘要,保留长期记忆;仅 service_role 可读写';
