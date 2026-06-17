-- ============================================================
-- hanako 私信 AI：独立模型配置表 + 每用户护栏状态表
-- 在 Supabase → SQL Editor 整段执行（幂等，可重复跑）
-- ============================================================
--
-- 设计：私信 AI 跟弹幕墙的 ai_config 完全解耦，可挂"另一套模型"。
-- 两张表都 enable RLS 且不写任何 policy → 只有 service_role 能读写，
-- api_key 绝不会被前端/匿名拉到（与 ai_config 同套路）。

-- ① 私信 AI 的独立配置（单行表）
create table if not exists public.dm_ai_config (
  id                int primary key default 1 check (id = 1),
  enabled           boolean not null default false,                       -- 私信回复总开关
  base_url          text    not null default 'https://api.deepseek.com/v1',
  api_key           text    not null default '',
  model             text    not null default 'deepseek-chat',
  persona           text    not null default '',                          -- 私信人设(空=用代码默认)
  proactive_enabled boolean not null default false,                       -- 主动私信总开关(第2批用)
  cooldown_hours    int     not null default 24,                          -- 同一人多少小时内最多被主动私信1次
  max_unanswered    int     not null default 2,                           -- 连发几条没回就停止主动私信
  updated_at        timestamptz default now(),
  updated_by        uuid
);
alter table public.dm_ai_config enable row level security;  -- 无 policy → 仅 service_role
insert into public.dm_ai_config (id) values (1) on conflict (id) do nothing;

-- ② 每用户私信护栏状态 + opt-out
create table if not exists public.hanako_dm_state (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  opted_out         boolean not null default false,    -- 用户要求别再私信(她要尊重)
  last_proactive_at timestamptz,                        -- 上次"主动"私信时刻(频率控制)
  unanswered_streak int not null default 0,            -- 连续主动私信未获回复数
  updated_at        timestamptz default now()
);
alter table public.hanako_dm_state enable row level security;  -- 无 policy → 仅 service_role

comment on table public.dm_ai_config  is 'hanako 私信 AI 独立模型配置(与弹幕墙 ai_config 解耦);仅 service_role 可读写';
comment on table public.hanako_dm_state is 'hanako 私信每用户护栏:opt-out / 频率 / 连续未回';
