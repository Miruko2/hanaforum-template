-- ============================================================
-- live_comments 速率限制（RLS 层强制）
-- 每个用户：过去 3 秒内最多 2 条
-- 在 Supabase Dashboard → SQL Editor 里整段执行一次即可（幂等）
--
-- 说明：
--   - hanako 自己（HANAKO_USER_ID）通过 service-role 写入，绕过 RLS，不受此限
--   - 子查询命中 idx_live_comments_created_at 索引，单次开销 < 1ms
--   - 攻击者改前端无法绕过，数据库层强制
-- ============================================================

DROP POLICY IF EXISTS "live_comments_insert_own" ON public.live_comments;

CREATE POLICY "live_comments_insert_own"
  ON public.live_comments
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND (
      SELECT count(*) FROM public.live_comments
      WHERE user_id = auth.uid()
        AND created_at > now() - interval '3 seconds'
    ) < 2
  );

COMMENT ON POLICY "live_comments_insert_own" ON public.live_comments IS
  '只允许登录用户写自己的弹幕，且每 3 秒最多 2 条（反刷屏）';
