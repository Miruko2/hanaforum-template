-- notifications 表加 meta jsonb 列：承载「点击通知后要在弹窗里完整展示」的结构化数据。
-- ============================================================
-- 目前用于 friend_link_apply（友链申请通知）：把整条申请的快照
--   { site_name, site_url, icon_url, description, contact, created_at }
-- 存进 meta，点击通知即弹「公告同款」详情弹窗、完整展示，无需再回查 friend_link_submissions。
--
-- 纯增量、可空、对既有所有通知零影响（老通知 meta = null，弹窗自动回落显示 message）。
-- 在 Supabase 控制台 → SQL Editor 整段执行即可。幂等，可重复跑。
-- ============================================================
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS meta jsonb;
