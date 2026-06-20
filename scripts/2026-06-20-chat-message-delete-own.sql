-- 消息撤回 / 删除：允许用户删除自己发的消息（chat_messages / dm_messages）。
-- ============================================================
-- 原来只有管理员能删（chat_messages_delete_admin / dm_delete_admin 保留不动）；
-- 这里新增「删自己发的」策略。Postgres 同一操作的多条策略是 OR 关系，
-- 故「自己」+「管理员」叠加生效：自己撤回自己的，管理员另可删大厅任意消息。
--
-- 硬删除（直接删行）：删除后经 realtime DELETE 事件从所有人界面移除。
--   - chat_messages：大厅 DELETE 订阅无 filter，DEFAULT replica identity（带主键）即够；
--   - dm_messages：私聊 DELETE 订阅按 pair_key 过滤，依赖 REPLICA IDENTITY FULL
--     （已由 2026-06-17-dm-read-receipts.sql 设置）→ DELETE 事件带完整旧行、过滤命中。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行一次（幂等，可重复跑）。
-- ============================================================

-- 大厅：自己发的可删
drop policy if exists "chat_messages_delete_own" on public.chat_messages;
create policy "chat_messages_delete_own" on public.chat_messages
  for delete using (auth.uid() = user_id);

-- 私聊：自己发的可删（管理员看不到私聊，故私聊只有「自己删自己」有意义）
drop policy if exists "dm_delete_own" on public.dm_messages;
create policy "dm_delete_own" on public.dm_messages
  for delete using (auth.uid() = sender_id);

-- ============================================================
-- 回滚：
--   drop policy if exists "chat_messages_delete_own" on public.chat_messages;
--   drop policy if exists "dm_delete_own" on public.dm_messages;
-- ============================================================
