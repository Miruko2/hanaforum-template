-- ============================================================
-- 论坛安全加固（来自 2026-06-21 防护审计）- 第 1 / 2 / 4 项
--
-- 本文件三项均为「零用户可见影响、纯后端/策略层加固、易回滚」，可整段直接执行。
-- 面向用户、需逐项验证的 storage 桶收窄（审计第 3 项）单独放
-- scripts/2026-06-21-storage-listing-lockdown.sql，不在此文件。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行。幂等，可重复跑。
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 【第 1 项 · 低危完整性缺口】comment_likes 的 INSERT 策略
--
-- 现状：INSERT 策略 WITH CHECK = true —— 任何登录用户可插入「任意 user_id」的点赞，
--       能冒名点赞、或借公开的 user_id 把某条评论赞数刷到全站用户数（有
--       UNIQUE(comment_id,user_id) 兜底，不能无限刷同一条，但仍属完整性问题）。
-- 对比：本表自己的 DELETE 策略、以及 comments 表的写入策略都正确校验了
--       auth.uid() = user_id，唯独这条 INSERT 漏了。
-- 修法：收紧为「只能给自己点的赞落账」。对正常点赞零影响（前端本就填自己的 user_id）。
-- ────────────────────────────────────────────────────────────
drop policy if exists "评论点赞可被已认证用户创建" on public.comment_likes;
create policy "评论点赞可被已认证用户创建"
  on public.comment_likes
  for insert
  to authenticated
  with check (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────
-- 【第 2 项 · 加固】固定函数 search_path（advisor: function_search_path_mutable）
--
-- 现状：下列 13 个函数未显式设 search_path，继承调用者会话的 search_path，
--       理论上可被同名对象劫持（handle_new_user 还是 SECURITY DEFINER，劫持=提权）。
-- 修法：统一设 search_path = public, pg_temp。
--       · 不重写函数体：体内裸表名仍解析到 public，零破坏（已逐一核对，均只引用
--         public 对象或触发器 NEW/OLD 变量）。
--       · pg_temp 显式放最后：杜绝「临时表 schema 默认抢先解析」的劫持路径。
-- ────────────────────────────────────────────────────────────
alter function public.handle_new_user()                                   set search_path = public, pg_temp;
alter function public.add_comment(uuid, uuid, text, uuid)                 set search_path = public, pg_temp;
alter function public.decrement(integer)                                  set search_path = public, pg_temp;
alter function public.dm_active_dates(text)                               set search_path = public, pg_temp;
alter function public.enforce_user_music_track_cap()                      set search_path = public, pg_temp;
alter function public.get_table_info(text)                                set search_path = public, pg_temp;
alter function public.hall_active_dates()                                 set search_path = public, pg_temp;
alter function public.increment(integer)                                  set search_path = public, pg_temp;
alter function public.like_post(uuid, uuid)                               set search_path = public, pg_temp;
alter function public.list_posts(integer, integer, text)                  set search_path = public, pg_temp;
alter function public.unlike_post(uuid, uuid)                             set search_path = public, pg_temp;
alter function public.update_modified_column()                           set search_path = public, pg_temp;
alter function public.update_updated_at_column()                         set search_path = public, pg_temp;


-- ────────────────────────────────────────────────────────────
-- 【第 4 项 · 加固】收回纯后端表对 anon/authenticated 的 SELECT
--           (advisor: pg_graphql_anon/authenticated_table_exposed)
--
-- 现状：下列 8 张表 RLS 已启用但无策略（前端 anon/authenticated 本就读不到任何行），
--       却仍 GRANT 了 SELECT，使其表结构在 GraphQL/PostgREST 中可被探测。
-- 已核对：这些表的读写全部发生在 app/api/** 与 lib/**（service-role 身份），
--         无任何前端 anon 读取，故收回 anon/authenticated 的 SELECT 不影响功能。
--         service_role 是独立角色、权限不受本次 REVOKE 影响。
-- 注：仅收 SELECT（精确对应 advisor 警告）；如需更彻底可改为 REVOKE ALL。
-- ────────────────────────────────────────────────────────────
revoke select on table public.ai_config             from anon, authenticated;
revoke select on table public.dm_ai_config          from anon, authenticated;
revoke select on table public.dm_conv_summary       from anon, authenticated;
revoke select on table public.hanako_dm_state       from anon, authenticated;
revoke select on table public.mengmegzi_action_log  from anon, authenticated;
revoke select on table public.mengmegzi_agent_state from anon, authenticated;
revoke select on table public.mengmegzi_config      from anon, authenticated;
revoke select on table public.users                 from anon, authenticated;

-- 让 PostgREST 立即重载 schema（否则要等它自动刷新才在 API 层生效）
notify pgrst, 'reload schema';


-- ============================================================
-- 验证（执行后跑一遍，三段结果都应符合预期）
-- ============================================================

-- 验证 1：comment_likes 的 INSERT 策略，with_check 应为 (auth.uid() = user_id)
select policyname, cmd, roles, with_check
from pg_policies
where schemaname = 'public' and tablename = 'comment_likes' and cmd = 'INSERT';

-- 验证 2：13 个函数的 proconfig 都应包含 search_path=public,pg_temp（无 null）
select p.proname, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('handle_new_user','add_comment','decrement','dm_active_dates',
    'enforce_user_music_track_cap','get_table_info','hall_active_dates','increment',
    'like_post','list_posts','unlike_post','update_modified_column','update_updated_at_column')
order by p.proname;

-- 验证 3：8 张表对 anon/authenticated 的 SELECT 应全部为 false
select t.table_name,
       has_table_privilege('anon', 'public.' || t.table_name, 'SELECT')          as anon_select,
       has_table_privilege('authenticated', 'public.' || t.table_name, 'SELECT') as auth_select
from (values ('ai_config'),('dm_ai_config'),('dm_conv_summary'),('hanako_dm_state'),
             ('mengmegzi_action_log'),('mengmegzi_agent_state'),('mengmegzi_config'),('users')
     ) as t(table_name)
order by t.table_name;
