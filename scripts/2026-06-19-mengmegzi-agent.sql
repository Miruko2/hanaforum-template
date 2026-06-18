-- ============================================================
-- 萌萌子 Agent：状态机 + 配置 + 行动日志
-- 在 Supabase → SQL Editor 整段执行（幂等，可重复跑）
-- 全部 enable RLS 无 policy → 仅 service_role 可读写
-- ============================================================

-- ① 状态机（单行表）
create table if not exists public.mengmegzi_agent_state (
  id              int primary key default 1 check (id = 1),
  status          text not null default 'idle',   -- idle=休息中 / busy=行动中 / dead=死机
  current_task    text not null default '',       -- 行动中时描述当前任务
  last_error      text not null default '',       -- 死机时的错误信息
  last_action_at  timestamptz,                    -- 上次成功行动时刻
  last_error_at   timestamptz,                    -- 上次出错时刻
  busy_since      timestamptz,                    -- 进入 busy 的时刻（超时判定）
  pending_task    jsonb,                          -- 待办任务，null=没有
  updated_at      timestamptz not null default now()
);
alter table public.mengmegzi_agent_state enable row level security;
insert into public.mengmegzi_agent_state (id) values (1) on conflict (id) do nothing;

-- ② 配置（单行表）
create table if not exists public.mengmegzi_config (
  id                       int primary key default 1 check (id = 1),
  comment_polling_enabled  boolean not null default false,
  comment_interval_min     int not null default 30,
  comment_scan_hours       int not null default 24,
  busy_timeout_min         int not null default 5,
  image_sources            jsonb not null default '{}'::jsonb,
  updated_at               timestamptz not null default now()
);
alter table public.mengmegzi_config enable row level security;
insert into public.mengmegzi_config (id, image_sources) values (1, '{
  "general": {"provider": "unsplash", "query": "daily life"},
  "nsfw":    {"provider": "none"},
  "game":    {"provider": "unsplash", "query": "video game"},
  "code":    {"provider": "none"},
  "life":    {"provider": "unsplash", "query": "lifestyle"},
  "help":    {"provider": "none"}
}'::jsonb) on conflict (id) do nothing;

-- ③ 行动日志
create table if not exists public.mengmegzi_action_log (
  id             bigint generated always as identity primary key,
  action_type    text not null,        -- post / comment / reply
  target_id      uuid,                 -- comment:帖子id; reply:被回复评论id; post:null
  result         text not null,        -- success / error
  detail         text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists idx_mengmegzi_log_target on public.mengmegzi_action_log(action_type, target_id);
create unique index if not exists uq_mengmegzi_comment_per_post
  on public.mengmegzi_action_log(target_id)
  where action_type = 'comment' and result = 'success' and target_id is not null;
alter table public.mengmegzi_action_log enable row level security;

comment on table public.mengmegzi_agent_state is '萌萌子 Agent 状态机(idle/busy/dead);仅 service_role';
comment on table public.mengmegzi_config is '萌萌子 Agent 行为参数;仅 service_role';
comment on table public.mengmegzi_action_log is '萌萌子 Agent 行动日志+防重复;仅 service_role';
