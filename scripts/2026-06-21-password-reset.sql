-- 忘记密码（自建 OTP 重置）所需的库对象。在 Supabase SQL Editor 手动跑一次。
-- 与现有「邮箱验证 OTP」完全独立：单独的表 + 单独的查码函数，互不污染。
--
-- 安全：
--   · password_reset_codes 开 RLS 但【不建任何策略】= 公众零访问；仅后端 service_role（绕 RLS）读写。
--   · find_user_id_by_email 为 SECURITY DEFINER（需读 auth.users，该 schema 不经 PostgREST 暴露），
--     已 REVOKE 掉 anon/authenticated，只授予 service_role —— 不是公开的「邮箱是否注册」探测口。

-- 1) 重置验证码表：每个用户至多一条待处理重置（按 user_id 主键 upsert 覆盖）。
create table if not exists public.password_reset_codes (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  code_hash        text,
  code_expires_at  timestamptz,
  attempts         integer     not null default 0,
  last_sent_at     timestamptz,
  request_ip       text,
  updated_at       timestamptz not null default now()
);

alter table public.password_reset_codes enable row level security;
-- 故意不建任何 policy：anon / authenticated 一律被拒，只有 service_role 能读写。

-- 按 IP 限频要查「该 IP 最近一小时发了几次」，给 (request_ip, last_sent_at) 建索引。
create index if not exists idx_prc_ip_sent
  on public.password_reset_codes (request_ip, last_sent_at);

-- 2) 按邮箱反查 user_id。auth.users 不经 PostgREST 暴露，故用 SECURITY DEFINER 函数封装。
--    大小写不敏感 + 去首尾空白。仅 service_role 可调用。
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select id
  from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1
$$;

revoke all on function public.find_user_id_by_email(text) from public;
revoke all on function public.find_user_id_by_email(text) from anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;

-- 跑完即生效。若 RPC 报「function not found」，等几秒让 PostgREST 刷新 schema 缓存，
-- 或在 Dashboard 任意保存一次触发刷新。验证：
--   select public.find_user_id_by_email('你的邮箱@example.com');  -- 应返回该用户的 uuid
