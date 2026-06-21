-- ============================================================
-- 推送设备令牌表 push_tokens（FCM registration token）
-- 每个用户每台设备一条；登录后客户端注册、登出时移除。
-- 写入不开放直写，统一走下方两个 SECURITY DEFINER 函数。
-- 在 Supabase → SQL Editor 整段执行（幂等，可重复跑）。
-- ============================================================

create table if not exists public.push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null unique,          -- FCM token：设备级唯一
  platform   text not null default 'android' check (platform in ('android', 'ios', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_push_tokens_user on public.push_tokens(user_id);

alter table public.push_tokens enable row level security;

-- 读：用户只能看自己的设备 token（将来做"已登录设备"管理 UI 可复用）
drop policy if exists "push_tokens_select_own" on public.push_tokens;
create policy "push_tokens_select_own" on public.push_tokens
  for select using (auth.uid() = user_id);
-- 不建 insert/update/delete 策略 → 客户端无法直写，强制走下面的函数。
-- service_role（Edge Function）绕过 RLS，可查全部 + 清理失效 token。

-- 注册 / 刷新 token：以当前登录用户身份 upsert。
-- 用 SECURITY DEFINER 是为了「同一台设备换账号登录」——
-- token 是设备级唯一的，换账号后要把它改挂到新用户名下（on conflict 重新赋 user_id）。
create or replace function public.register_push_token(p_token text, p_platform text default 'android')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_token is null or btrim(p_token) = '' then
    return;
  end if;
  insert into public.push_tokens (user_id, token, platform, updated_at)
  values (auth.uid(), p_token, coalesce(p_platform, 'android'), now())
  on conflict (token)
  do update set user_id    = excluded.user_id,
                platform   = excluded.platform,
                updated_at = now();
end;
$$;

-- 注销：移除指定 token（登出时调用）。token 本身是设备持有的"凭据"，
-- 按 token 精确删；授予 anon 是因为登出后会话已清空（角色变 anon）仍要能删自己这条。
create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token is null or btrim(p_token) = '' then
    return;
  end if;
  delete from public.push_tokens where token = p_token;
end;
$$;

revoke all on function public.register_push_token(text, text) from public, anon;
revoke all on function public.unregister_push_token(text) from public;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated, anon;

comment on table public.push_tokens is 'FCM 设备推送令牌；写入走 register_push_token / unregister_push_token';
