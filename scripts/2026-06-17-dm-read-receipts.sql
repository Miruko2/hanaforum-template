-- ============================================================
-- 私信已读回执 - 2026-06-17
-- 配套：app/api/dm-read、components/floating-chat.tsx 的「已读」气泡
--
-- 目标：在 dm_messages 上加 read_at 列，接收方读消息时由
--      /api/dm-read（service_role）置位 now()，发送方经 realtime
--      UPDATE 订阅实时看到「已读」。NULL=未读。
--
-- 安全：
--   - 客户端无 UPDATE RLS 策略，仍不能直接改 dm_messages；
--     read_at 只能由 service_role（/api/dm-read，已校验
--     recipient_id=当前用户、且只 NULL→now 单向推进）写入。
--   - 不影响现有 INSERT/SELECT/DELETE 策略。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行一次（幂等，可重复跑）。
-- ============================================================

-- 1) 读状态列（NULL=未读）
ALTER TABLE public.dm_messages
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

COMMENT ON COLUMN public.dm_messages.read_at IS '接收方读消息的时刻（NULL=未读）。仅由 service_role(/api/dm-read) 写入，单向 NULL→now。';

-- 2) 部分索引：加速「我的未读消息」查询（未来未读数切服务端驱动时复用）
CREATE INDEX IF NOT EXISTS idx_dm_recipient_unread
  ON public.dm_messages (recipient_id)
  WHERE read_at IS NULL;

-- 3) REPLICA IDENTITY FULL：让 UPDATE 事件在 realtime 里带完整 new 行
--    （含 read_at），发送方订阅 UPDATE 即可拿到「对方已读」。
--    不改 supabase_realtime publication（该表早已在列，避免误重置 publication 表集合）。
ALTER TABLE public.dm_messages REPLICA IDENTITY FULL;

-- ============================================================
-- 回滚：
--   ALTER TABLE public.dm_messages REPLICA IDENTITY DEFAULT;
--   DROP INDEX IF EXISTS public.idx_dm_recipient_unread;
--   ALTER TABLE public.dm_messages DROP COLUMN IF EXISTS read_at;
-- ============================================================
