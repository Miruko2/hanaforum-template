-- ============================================================
-- 萌萌子 Agent：新增「定时自动发帖」轮询（与留言轮询并列的独立分支）
-- 在 Supabase → SQL Editor 执行一次。幂等（IF NOT EXISTS），可重复跑。
--
-- mengmegzi_config：
--   · post_polling_enabled —— 开关（默认关，面板里开）
--   · post_interval_min    —— 每隔多少分钟自动发一帖（默认 120）
--   · post_category        —— 指定分类（''=随机；合法值见 lib/categories）
-- mengmegzi_agent_state：
--   · last_post_at —— 上次自动发帖时间。**独立于 last_action_at**：发帖轮询用它计时，
--     这样留言/回复再频繁也不会把发帖的节奏顶掉（两条轮询各自计时、互不干扰）。
-- ============================================================

alter table public.mengmegzi_config
  add column if not exists post_polling_enabled boolean not null default false,
  add column if not exists post_interval_min    integer not null default 120,
  add column if not exists post_category         text    not null default '';

alter table public.mengmegzi_agent_state
  add column if not exists last_post_at timestamptz;

-- 核对：
-- select post_polling_enabled, post_interval_min, post_category from public.mengmegzi_config where id = 1;
