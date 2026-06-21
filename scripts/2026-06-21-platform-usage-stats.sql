-- 平台用量面板 · Supabase 库/存储大小只读统计函数
-- ─────────────────────────────────────────────────────────────
-- 用途：点亮管理面板「平台用量」tab 里的 Supabase 卡片（数据库大小 + 存储桶总大小）。
-- 口径与 count_engaged_users 一致：SECURITY DEFINER + 仅 service_role 可执行。
-- 在 Supabase SQL Editor 跑一次即可（只建只读函数，零数据改动、可反复跑）。
--
-- ⚠️ egress（缓存出站流量，上次坑你超额那个）无法用 SQL 或 Management API 拿到，
--    只能去 Dashboard → Billing 看，本函数不含、面板该卡会注明。

create or replace function public.admin_platform_storage_stats()
returns json
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_db_bytes bigint;
  v_storage_bytes bigint;
begin
  -- 整库大小（含索引/WAL 不计，approx 与 Dashboard 的 Database size 一致量级）
  select pg_database_size(current_database()) into v_db_bytes;

  -- 存储桶所有对象的总大小：累加 storage.objects.metadata->>'size'
  select coalesce(sum((metadata->>'size')::bigint), 0)
    into v_storage_bytes
    from storage.objects;

  return json_build_object(
    'db_bytes', v_db_bytes,
    'storage_bytes', v_storage_bytes
  );
end;
$$;

-- 收紧执行权限：只有后端 service_role 能调，匿名/登录用户都不能
revoke all on function public.admin_platform_storage_stats() from public, anon, authenticated;
grant execute on function public.admin_platform_storage_stats() to service_role;


-- ═════════════════════════════════════════════════════════════
-- 自记用量日志：给没有官方用量 API 的平台（Resend 发信 / 小米 MiMo token）
-- ═════════════════════════════════════════════════════════════
-- Resend 没有用量查询接口、MiMo 余额端点要登录 cookie，都拿不到官方数字 →
-- 由后端在「发信成功 / AI 调用成功」时自记一笔，本函数聚合给面板对应卡片。
-- 写入方：lib/platform-usage.ts（service_role 绕 RLS）。

create table if not exists public.platform_usage_log (
  id          bigint generated always as identity primary key,
  provider    text        not null,        -- 'resend' | 'mimo'
  metric      text        not null,        -- 'email'  | 'tokens'
  amount      bigint      not null default 1,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

-- 按平台 + 时间倒序查（聚合「今日/本月」用得上）
create index if not exists platform_usage_log_provider_time_idx
  on public.platform_usage_log (provider, created_at desc);

-- 这是内部遥测表：开 RLS 但不建任何策略 = 匿名/登录用户一律读不到；
-- service_role（后端）天然绕过 RLS，可读写。
alter table public.platform_usage_log enable row level security;

-- 聚合：Resend 今日/本月发信数 + MiMo 本月 token/调用次数（按 UTC 自然日/月，
-- 与 Resend 配额、Cloudflare 卡的 UTC 口径一致）。
create or replace function public.admin_platform_usage_stats()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day   timestamptz := date_trunc('day',   now() at time zone 'UTC') at time zone 'UTC';
  v_month timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  v_resend_day   int;
  v_resend_month int;
  v_mimo_tokens  bigint;
  v_mimo_calls   int;
begin
  select count(*) into v_resend_day
    from public.platform_usage_log
    where provider = 'resend' and metric = 'email' and created_at >= v_day;

  select count(*) into v_resend_month
    from public.platform_usage_log
    where provider = 'resend' and metric = 'email' and created_at >= v_month;

  select coalesce(sum(amount), 0), count(*) into v_mimo_tokens, v_mimo_calls
    from public.platform_usage_log
    where provider = 'mimo' and metric = 'tokens' and created_at >= v_month;

  return json_build_object(
    'resend_day',        v_resend_day,
    'resend_month',      v_resend_month,
    'mimo_month_tokens', v_mimo_tokens,
    'mimo_month_calls',  v_mimo_calls
  );
end;
$$;

revoke all on function public.admin_platform_usage_stats() from public, anon, authenticated;
grant execute on function public.admin_platform_usage_stats() to service_role;
