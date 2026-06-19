-- ============================================================================
-- 私聊「日期跳转」的日期索引 RPC：dm_active_dates(pk)
--
-- 目标：一次拿到某会话「有消息的日期 + 当日条数」，不查消息内容、只聚合日期。
--   · payload 极小（去重后就几十行），不随消息总量膨胀 → 刻度轨永远轻量；
--   · 走已有索引 idx_dm_pair_created (pair_key, created_at)，万条也毫秒级；
--   · 按 Asia/Shanghai 切天（受众在国内，"6月3日" 按本地日；前端 lib/cn-date.ts 同时区）。
--
-- 返回的 cnt（当日条数）为「波形」皮肤预留（按当日条数当振幅）；只做刻度轨可忽略该列。
--
-- 安全：默认 SECURITY INVOKER → 函数以调用者身份执行，受 dm_messages 的 RLS
-- (dm_select_own：仅会话双方可 select) 约束。非本人对会话查不到任何日期。
-- ============================================================================

create or replace function public.dm_active_dates(pk text)
returns table(d date, cnt integer)
language sql
stable
as $$
  select (created_at at time zone 'Asia/Shanghai')::date as d,
         count(*)::int as cnt
  from public.dm_messages
  where pair_key = pk
  group by 1
  order by 1 desc
$$;

-- 仅登录用户可调用（聊天本就要求登录）。
grant execute on function public.dm_active_dates(text) to authenticated;

comment on function public.dm_active_dates(text) is
  '私聊日期索引：返回某 pair_key 有消息的日期(上海时区)与当日条数，新→旧。受 RLS 约束仅双方可查。';

-- ============================================================================
-- 大厅日期索引：hall_active_dates()
-- 同上，但查公共大厅 chat_messages（无 pair_key，全房一份）。受 chat_messages 的
-- RLS 约束（大厅消息对登录用户可读）。万条消息去重后日期也就几百个，聚合很轻。
-- ============================================================================
create or replace function public.hall_active_dates()
returns table(d date, cnt integer)
language sql
stable
as $$
  select (created_at at time zone 'Asia/Shanghai')::date as d,
         count(*)::int as cnt
  from public.chat_messages
  group by 1
  order by 1 desc
$$;

grant execute on function public.hall_active_dates() to authenticated;

comment on function public.hall_active_dates() is
  '大厅日期索引：返回 chat_messages 有消息的日期(上海时区)与当日条数，新→旧。';

-- 回滚：
--   DROP FUNCTION IF EXISTS public.dm_active_dates(text);
--   DROP FUNCTION IF EXISTS public.hall_active_dates();
