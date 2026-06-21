-- ============================================================
-- 文本审核引擎升级：分类分级 + 白名单 + 审核队列 - 2026-06-21
-- 配套改写：supabase/functions/moderate-text/index.ts（须同时部署）
--
-- 背景：原 moderate-text 只做「裸子串匹配 → 命中即删整帖」，词库只有政治类、
--       不分级、无白名单豁免、无变体对抗。本次把引擎升级为可扩展的分类分级体系：
--   · sensitive_words 加 action：block(删+通知) / flag(仅入队待人工)
--   · 新增 moderation_allowlist：豁免词，破「大约/鞭炮/法律」被「约/炮/法」误杀
--   · 新增 moderation_queue：flag 命中（及将来 AI 复判存疑）入队，管理面板人工处理
--   · 归一化在 Edge Function 内做（小写/全角转半角/去零宽与分隔符），对抗 "v★信"
--
-- 兼容：存量 303 条政治词 action 默认 block，行为与升级前完全一致。
-- 性能：审查仍在 Edge Function 异步跑、不在 DB 内；词库查询有 60s 缓存。两张新表
--       小、低频读写，对 DB 无实质负担。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行。幂等，可重复跑。
-- ============================================================


-- 1) sensitive_words 加 action 列（block / flag），存量默认 block 保持原行为
alter table public.sensitive_words
  add column if not exists action text not null default 'block';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sensitive_words_action_chk') then
    alter table public.sensitive_words
      add constraint sensitive_words_action_chk check (action in ('block', 'flag'));
  end if;
end $$;

-- category 不加严格枚举约束，保持可随管理面板自由扩分类。
-- 约定值：政治 / 色情 / 辱骂 / 广告 / 违法（前端下拉用，DB 不强制）。
comment on column public.sensitive_words.action is 'block=删除+通知 / flag=仅写入审核队列待人工';


-- 2) 白名单（豁免词）：命中敏感词若整体落在某白名单短语内则豁免
create table if not exists public.moderation_allowlist (
  id         bigint generated always as identity primary key,
  phrase     text not null,
  note       text,                       -- 备注：豁免它是为了放行哪类正常表达
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists moderation_allowlist_phrase_lower_key
  on public.moderation_allowlist (lower(phrase));
comment on table public.moderation_allowlist is '文本审核白名单/豁免词（私有，仅管理员/服务端可见）';


-- 3) 审核队列：flag 命中入队，管理面板人工复核（通过 / 删除）
create table if not exists public.moderation_queue (
  id          bigint generated always as identity primary key,
  table_name  text not null,             -- posts / comments / live_comments
  record_id   uuid not null,
  user_id     uuid,
  content     text,                       -- 命中内容快照（原文，便于管理面板直接看）
  category    text,                       -- 命中分类
  matched     text,                       -- 命中词 / 将来 AI 复判理由
  source      text not null default 'keyword',  -- keyword / ai
  status      text not null default 'pending', -- pending / approved / removed
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);
-- 一条内容只占一行（UPDATE 重判时 upsert 刷新）
create unique index if not exists moderation_queue_record_key
  on public.moderation_queue (table_name, record_id);
-- 管理面板按状态+时间倒序拉取
create index if not exists moderation_queue_status_idx
  on public.moderation_queue (status, created_at desc);
comment on table public.moderation_queue is '文本审核待人工队列（flag 命中 / AI 存疑）';


-- 4) RLS：两张新表都只管理员可读写；Edge Function 用 service_role 自动绕过 RLS
alter table public.moderation_allowlist enable row level security;
drop policy if exists moderation_allowlist_admin_all on public.moderation_allowlist;
create policy moderation_allowlist_admin_all on public.moderation_allowlist
  for all
  using      (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));

alter table public.moderation_queue enable row level security;
drop policy if exists moderation_queue_admin_all on public.moderation_queue;
create policy moderation_queue_admin_all on public.moderation_queue
  for all
  using      (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));


-- ============================================================
-- 验证（执行后应符合预期）
-- ============================================================

-- 1：sensitive_words 应出现 action 列，存量行均为 block
select count(*) as total, count(*) filter (where action = 'block') as block_cnt
from public.sensitive_words;

-- 2：两张新表存在且 RLS 已启用
select relname, relrowsecurity
from pg_class
where relname in ('moderation_allowlist', 'moderation_queue');
