-- ============================================================
-- 修复：客户端创建通知被 RLS 拒绝 (42501 new row violates RLS for "notifications")
-- ------------------------------------------------------------
-- 背景：2026-05-31 安全修复删除了 notifications 的"通杀"策略
--   enable_all_access_notifications (CRIT-5)。删除后，剩下的 INSERT 策略
--   "通知只能由系统创建" 实际不放行 authenticated 客户端（限定了 service_role），
--   导致点赞/评论时 createNotification 全部 42501 失败 ——
--   通知功能从 2026-05-31 起对客户端失效。
--
--   注意：post_removed 通知由 Edge Function 用 service_role 写入，
--   service_role 始终绕过 RLS，因此不受影响（这也解释了为什么
--   只有"图片违规"通知能正常出现，点赞/评论通知却消失）。
--
-- 真正的根因（经反复排查确认）：notifications 上生效的 INSERT 策略实际是
--   WITH CHECK (user_id = auth.uid())，即只允许"给自己发通知"。
--   但通知语义是 "A 通知 B"：user_id = 接收者(B) ≠ 发起者(A) = auth.uid()，
--   所以所有点赞/评论通知(给别人发)都被这条策略拦下，报 42501。
--   （之前误判为匿名/token 问题，是因为手动测试都用 user_id=自己，恰好绕过了它。）
--
-- 修法：改成按"发起者 = 当前登录用户"判定 —— actor_id = auth.uid()。
--   - 接收者 user_id 可以是任何人 → "A 通知 B" 成立；
--   - 三处 createNotification 的 actorId 都是当前用户 → 放行；
--   - 仍防伪造：无法冒充他人(actor_id≠自己)去发通知；
--   - service_role 写 post_removed 绕过 RLS，不受影响。
-- ============================================================

-- 删掉 notifications 上所有 INSERT 策略（不论名字，一次清干净，避免残留旧的 user_id 策略）
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname='public' AND tablename='notifications' AND cmd='INSERT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.notifications', p.policyname);
  END LOOP;
END $$;

-- 正确策略：登录用户只能以"自己为触发者"创建通知
CREATE POLICY "通知由触发者创建" ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- 自检：确认 notifications 上的 INSERT 策略已就位
SELECT policyname, cmd, roles, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'notifications' AND cmd = 'INSERT';
