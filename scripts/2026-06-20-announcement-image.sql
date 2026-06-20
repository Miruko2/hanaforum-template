-- ============================================================
-- 公告支持配图（单张）
-- ------------------------------------------------------------
-- 给 announcements 表加 image_url 列，并让广播函数 broadcast_announcement
-- 接受可选的第三参数 p_image_url：管理员发公告时配的图，已在浏览器压缩为 webp
-- 后上传到 post-images 桶，这里只存它的公开 URL（可空）。
--
-- 与 2026-06-02-announcements-broadcast.sql 配套；在 Supabase 控制台 SQL Editor
-- 整段执行。幂等，可重复执行。
-- 依赖：public.is_admin(uuid)（见 2026-06-02-fix-admin-users-rls-recursion.sql）。
--
-- ⚠️ 部署顺序：必须先执行本脚本（DB 先有新函数），再上线「传 p_image_url」的前端代码，
--   否则前端 RPC 调用会因函数签名不匹配报「函数不存在」。
-- ============================================================

-- 1) 公告主体表加配图列（可空；旧公告与纯文字公告均为 NULL）
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS image_url text;

-- 2) 重建广播函数，新增可选参数 p_image_url。
--    先删掉旧的两参版本，避免与新三参版（第三参带 DEFAULT）在 (text,text) 调用上的重载歧义。
DROP FUNCTION IF EXISTS public.broadcast_announcement(text, text);

CREATE OR REPLACE FUNCTION public.broadcast_announcement(
  p_title text,
  p_content text,
  p_image_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  -- 鉴权：必须是登录的管理员（前端藏按钮不够，这里是真正的防线）
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION '只有管理员可以发布公告';
  END IF;

  -- 基本校验
  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION '公告标题不能为空';
  END IF;
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RAISE EXCEPTION '公告内容不能为空';
  END IF;

  -- 写公告主体（image_url 可空：空串/纯空白一律规整为 NULL）
  INSERT INTO public.announcements (title, content, image_url, created_by)
  VALUES (
    btrim(p_title),
    p_content,
    nullif(btrim(coalesce(p_image_url, '')), ''),
    v_uid
  )
  RETURNING id INTO v_id;

  -- 扇出：给每个用户各插一行通知。
  -- message 直接存标题，通知卡片无需回查即可显示；正文/配图点开弹窗时再按 announcement_id 取。
  INSERT INTO public.notifications (user_id, type, announcement_id, message, is_read, created_at)
  SELECT u.id, 'announcement', v_id, btrim(p_title), false, now()
  FROM auth.users u;

  RETURN v_id;
END;
$$;

-- 仅允许登录用户调用（函数内部再用 is_admin 二次校验）
REVOKE ALL ON FUNCTION public.broadcast_announcement(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.broadcast_announcement(text, text, text) TO authenticated;

-- 3) 自检：确认新函数签名（应为 3 个参数，第三个 p_image_url 带默认值）已就位
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'broadcast_announcement';
