-- ============================================================
-- profiles 增加「首页背景」独立字段：home_background_url - 2026-06-20
--
-- 背景：个人页新增「设置首页背景」毛玻璃按钮。这张图作为首页/全站底图（由 AppBackground
--       渲染层叠在 layout 默认底图上、切换时高斯模糊渐入）+ music 页底图，与个人卡片 banner 的 background_url
--       **完全独立**——两张图互不影响、各自上传/还原。
--   · home_background_url：首页背景外链（Supabase Storage 的 public URL；只存链接，
--                          显示由浏览器直连，服务器不托管字节，与头像/banner 同思路）。
--
-- 只「加列」，默认 NULL，不影响既有数据；profiles 现有 RLS（owner 可更新自己行）
-- 已覆盖该列的写入，无需新增 policy。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行（幂等，可重复跑）。
-- ⚠️ 必须先跑本迁移，前端「设置首页背景」功能才可用（未跑则读取静默返回 null、
--    上传会因列不存在报错；不影响其它个人资料读写）。
-- ============================================================

-- 1) 加列（默认 NULL，安全）
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS home_background_url text;

-- 2) 约束：只收 https（挡 javascript:/data:/明文 http）并限长。与 background_url 一致。
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_home_background_url_chk;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_home_background_url_chk
  CHECK (
    home_background_url IS NULL
    OR (home_background_url ~* '^https://' AND char_length(home_background_url) <= 2048)
  );

COMMENT ON COLUMN public.profiles.home_background_url IS '首页/全站背景图外链（https，≤2048 字符；与 background_url 独立）';
