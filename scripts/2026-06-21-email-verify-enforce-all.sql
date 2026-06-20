-- ============================================================
-- 邮箱验证：扩展到「所有未验证用户」(含老用户) - 2026-06-21
-- 配套：components/email-verify-gate.tsx、app/api/send-otp(多通道)
--
-- 背景：原 gate 只拦「enforce_since 之后注册的新用户」，老用户永久豁免。
--      现要求：未验证的老用户下次发帖/评论/弹幕/私信/聊天时也弹验证。
--      新增开关 enforce_all：true 时去掉「老用户豁免」，所有未验证者都要验证。
--
-- 安全：
--   - 仍受 enforce_since 总开关约束：enforce_since=NULL → 谁都不拦(验证整体关闭)。
--   - service_role(auth.uid()=NULL) 永远豁免。
--   - fail-open：配置缺失/异常 → 放行，绝不误锁。
--   - 兜底：邮件全通道发不出 → 当日 disabled_until 放行(send-otp 侧)。
--   - 解卡阀门：被卡的真实用户 → 管理面板「标记已验证」按钮(或下方 SQL)即可放行。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行一次(幂等，可重复跑)。
-- 注意：本段只是【加开关并改判定函数】，默认 enforce_all=false，跑完不影响任何人。
--      真正对老用户生效，要等你测好后再执行最底部的 UPDATE。
-- ============================================================

-- 1) 新增开关列（默认 false = 维持原行为：仅新用户）
ALTER TABLE public.verification_state
  ADD COLUMN IF NOT EXISTS enforce_all boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.verification_state.enforce_all IS
  'true=所有未验证用户都需验证(含老用户)；false=仅 enforce_since 之后注册的新用户。';

-- 2) 重写判定函数：enforce_all 时去掉「老用户豁免」
CREATE OR REPLACE FUNCTION public.email_verification_required(uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_enforce_since  TIMESTAMPTZ;
  v_disabled_until TIMESTAMPTZ;
  v_enforce_all    BOOLEAN;
  v_created_at     TIMESTAMPTZ;
  v_verified       BOOLEAN;
BEGIN
  IF uid IS NULL THEN RETURN FALSE; END IF;                 -- service_role / 匿名

  SELECT enforce_since, disabled_until, enforce_all
    INTO v_enforce_since, v_disabled_until, v_enforce_all
    FROM public.verification_state WHERE id = 1;

  IF v_enforce_since IS NULL THEN RETURN FALSE; END IF;     -- 验证总开关未开启
  IF v_disabled_until IS NOT NULL AND v_disabled_until > now() THEN
    RETURN FALSE;                                            -- 超额当日兜底窗口内，放行
  END IF;

  -- 老用户豁免：仅当未开启 enforce_all 时生效
  IF NOT COALESCE(v_enforce_all, false) THEN
    SELECT created_at INTO v_created_at FROM auth.users WHERE id = uid;
    IF v_created_at IS NULL OR v_created_at <= v_enforce_since THEN
      RETURN FALSE;                                          -- 老用户豁免 / 查不到
    END IF;
  END IF;

  SELECT (verified_at IS NOT NULL) INTO v_verified
    FROM public.email_verifications WHERE user_id = uid;
  IF v_verified IS TRUE THEN RETURN FALSE; END IF;          -- 已验证

  RETURN TRUE;                                               -- 未验证、未关闭 → 需验证
END;
$$;

-- ============================================================
-- 启用对【所有未验证用户】生效（确认多通道发信 + 验证流程都跑通后再执行）：
--   UPDATE public.verification_state SET enforce_all = true, updated_at = now() WHERE id = 1;
-- 回退到「仅新用户」：
--   UPDATE public.verification_state SET enforce_all = false, updated_at = now() WHERE id = 1;
--
-- 别忘了验证总开关本身（若还没开）：
--   UPDATE public.verification_state SET enforce_since = now(), updated_at = now() WHERE id = 1;
--
-- 手动解卡某个被验证卡住的真实用户（标记已验证）：
--   INSERT INTO public.email_verifications (user_id, verified_at)
--   VALUES ('<user-uuid>', now())
--   ON CONFLICT (user_id) DO UPDATE SET verified_at = now(), code_hash = NULL;
-- ============================================================
