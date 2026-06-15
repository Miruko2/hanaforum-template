-- ============================================================
-- 邮箱验证（懒触发 OTP + 超额自动兜底）- 2026-06-16
-- 配套：app/api/send-otp、app/api/verify-otp、components/email-verify-gate.tsx
--
-- 目标：注册不再被验证卡住（signUp 仍自动登录=天然兜底）；新用户在【首次
--      发帖/评论/弹幕等】时才要求验证（懒触发，省 Resend 额度）；Resend 发不出/
--      超额时当日自动跳过验证、放行，次日自动恢复。
--
-- 安全：
--   - 默认【关闭】：verification_state.enforce_since = NULL → 谁都不拦。
--     上线、手测 OTP 流程通过后，再执行：
--        UPDATE public.verification_state SET enforce_since = now(), updated_at = now() WHERE id = 1;
--     之后【只有该时刻之后注册的新用户】才需验证；老用户永远豁免。
--   - fail-open：配置缺失/查询异常/发不出信 → 一律放行，绝不误锁正常用户。
--   - service_role（auth.uid()=NULL）不受影响（hanako/审核/后台照常）。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行一次（幂等，可重复跑）。
-- ============================================================

-- 1) 验证记录表（每用户一行）
CREATE TABLE IF NOT EXISTS public.email_verifications (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash       TEXT,            -- 当前验证码的 sha256（验证成功/过期后清空）
  code_expires_at TIMESTAMPTZ,
  attempts        INT  NOT NULL DEFAULT 0,
  last_sent_at    TIMESTAMPTZ,
  verified_at     TIMESTAMPTZ,     -- 非空 = 已验证（含超额兜底放行）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.email_verifications IS '邮箱验证状态/OTP（懒触发）。verified_at 非空=已验证；写入仅 service_role。';

-- 2) 全局开关/状态（单行 id=1）
CREATE TABLE IF NOT EXISTS public.verification_state (
  id             INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enforce_since  TIMESTAMPTZ,       -- NULL=验证关闭；设了时刻=仅此后注册的用户需验证
  disabled_until TIMESTAMPTZ,       -- 非空且未来=当前因超额/发不出临时关闭验证（到点自动恢复）
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.verification_state (id, enforce_since, disabled_until)
  VALUES (1, NULL, NULL)
  ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.verification_state IS '邮箱验证全局状态。enforce_since=NULL 即关闭；disabled_until 为超额当日兜底窗口。';

-- 3) RLS
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
-- 用户只能看自己那行（前端据此判断是否需验证）；写入只走 service_role（无写策略）
DROP POLICY IF EXISTS email_verifications_select_self ON public.email_verifications;
CREATE POLICY email_verifications_select_self ON public.email_verifications
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.verification_state ENABLE ROW LEVEL SECURITY;
-- enforce_since/disabled_until 不敏感，允许所有人读（前端计算是否需验证）；写入只走 service_role
DROP POLICY IF EXISTS verification_state_select_all ON public.verification_state;
CREATE POLICY verification_state_select_all ON public.verification_state
  FOR SELECT USING (true);

-- 4) 判定函数：该用户写入前是否必须先验证邮箱（fail-open）
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
  v_created_at     TIMESTAMPTZ;
  v_verified       BOOLEAN;
BEGIN
  IF uid IS NULL THEN RETURN FALSE; END IF;                 -- service_role / 匿名

  SELECT enforce_since, disabled_until
    INTO v_enforce_since, v_disabled_until
    FROM public.verification_state WHERE id = 1;

  IF v_enforce_since IS NULL THEN RETURN FALSE; END IF;     -- 验证未开启
  IF v_disabled_until IS NOT NULL AND v_disabled_until > now() THEN
    RETURN FALSE;                                            -- 超额当日兜底窗口内，放行
  END IF;

  SELECT created_at INTO v_created_at FROM auth.users WHERE id = uid;
  IF v_created_at IS NULL OR v_created_at <= v_enforce_since THEN
    RETURN FALSE;                                            -- 老用户豁免 / 查不到
  END IF;

  SELECT (verified_at IS NOT NULL) INTO v_verified
    FROM public.email_verifications WHERE user_id = uid;
  IF v_verified IS TRUE THEN RETURN FALSE; END IF;          -- 已验证

  RETURN TRUE;                                               -- 新用户、未验证、未关闭 → 需验证
END;
$$;

GRANT EXECUTE ON FUNCTION public.email_verification_required(UUID) TO authenticated, anon;

-- 5) 写入拦截触发器函数（消息带 EMAIL_UNVERIFIED 标记，供前端识别并弹验证框）
CREATE OR REPLACE FUNCTION public.block_unverified_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.email_verification_required(auth.uid()) THEN
    RAISE EXCEPTION 'EMAIL_UNVERIFIED: 请先验证邮箱再发言' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 6) 挂到内容创建类基表（relkind='r' 过滤，自动跳过视图）。仅拦 INSERT。
DO $$
DECLARE
  t text;
  trig text;
  content_tables text[] := ARRAY[
    'posts', 'comments', 'live_comments', 'dm_messages', 'chat_messages'
  ];
BEGIN
  FOREACH t IN ARRAY content_tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      trig := 'trg_require_verified_' || t;
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', trig, t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE INSERT ON public.%I '
        || 'FOR EACH ROW EXECUTE FUNCTION public.block_unverified_write()', trig, t);
    ELSE
      RAISE NOTICE 'skip trg_require_verified_%: public.% 不是基表（视图或不存在）', t, t;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 启用（确认 OTP 流程线上跑通后再执行）：
--   UPDATE public.verification_state SET enforce_since = now(), updated_at = now() WHERE id = 1;
-- 临时全员放行（关闭验证）：
--   UPDATE public.verification_state SET enforce_since = NULL, updated_at = now() WHERE id = 1;
-- 手动清掉“超额当日兜底”窗口（立刻恢复验证）：
--   UPDATE public.verification_state SET disabled_until = NULL, updated_at = now() WHERE id = 1;
--
-- 回滚（完全移除）：
--   DROP TRIGGER IF EXISTS trg_require_verified_posts ON public.posts;
--   DROP TRIGGER IF EXISTS trg_require_verified_comments ON public.comments;
--   DROP TRIGGER IF EXISTS trg_require_verified_live_comments ON public.live_comments;
--   DROP TRIGGER IF EXISTS trg_require_verified_dm_messages ON public.dm_messages;
--   DROP TRIGGER IF EXISTS trg_require_verified_chat_messages ON public.chat_messages;
--   DROP FUNCTION IF EXISTS public.block_unverified_write();
--   DROP FUNCTION IF EXISTS public.email_verification_required(UUID);
--   DROP TABLE IF EXISTS public.email_verifications;
--   DROP TABLE IF EXISTS public.verification_state;
-- ============================================================
