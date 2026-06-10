-- ============================================================
-- profiles 增加社交资料字段：background_url（背景图）、bio（个人签名）- 2026-06-10
--
-- 背景：社交个人页(/user/[id]) 第 1 步。把个人资料从「头像 + 用户名」扩展到
--       「头像 + 背景图 + 签名」，后续可被他人访问。
--   · background_url：背景图外链（Supabase Storage 的 public URL；与头像同思路，
--                     只存链接、播放/显示由浏览器直连，服务器不托管字节）。
--   · bio          ：个人签名 / 简介，纯文本。
--
-- 只「加列」，默认 NULL，不影响既有数据；profiles 现有 RLS（owner 可更新自己行）
-- 已覆盖这两列的写入，无需新增 policy。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行（幂等，可重复跑）。
-- ============================================================

-- 1) 加列（默认 NULL，安全）
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS background_url text,
  ADD COLUMN IF NOT EXISTS bio           text;

-- 2) 约束：背景图只收 https（挡 javascript:/data:/明文 http）并限长；签名限长。
--    新列默认 NULL 不违反约束，可直接加。
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_background_url_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_background_url_chk
  CHECK (
    background_url IS NULL
    OR (background_url ~* '^https://' AND char_length(background_url) <= 2048)
  );

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_bio_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_bio_chk
  CHECK (bio IS NULL OR char_length(bio) <= 200);

COMMENT ON COLUMN public.profiles.background_url IS '社交页背景图外链（https，≤2048 字符）';
COMMENT ON COLUMN public.profiles.bio           IS '个人签名 / 简介（≤200 字符）';
