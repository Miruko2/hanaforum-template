-- ============================================================
-- storage 公开桶「禁止枚举文件名」（来自 2026-06-21 防护审计）- 第 3 项
--
-- ⚠️ 与 2026-06-21-security-hardening.sql 不同：本文件「面向全站用户」，
--    一旦对 Supabase Storage 行为判断有偏差，可能影响图片/头像/下载显示。
--    故单独成文，建议【低峰期执行】，并在执行后【立即验证】下列四件事。
--
-- ── 背景 ──
-- advisor(public_bucket_allows_listing) 指出 avatars / downloads / images /
-- post-images 四个公开桶存在「qual=true」的宽泛 SELECT 策略，允许匿名客户端
-- 用 storage list 接口枚举桶内全部文件名。
--
-- ── 为什么删它是安全的（已核对）──
--  1. 前端全局无任何 .list() 调用（不依赖「列出桶内文件」这个能力）。
--  2. 头像、帖子图、APK 全部走 getPublicUrl / cdnUrl / img.hanakos.cc 的
--     public URL 直连（/object/public/...），该路径【绕过 RLS】，不读这条 SELECT 策略。
--     例：app/download/page.tsx 注释明写「getPublicUrl 纯字符串拼接、不发请求」。
--  3. 上传走 INSERT 策略、owner 读自己的 post-images 走那条 ALL 策略，均不受影响。
-- 故删除下列两条宽泛 SELECT 策略后，面向用户的读取零影响，仅关闭「匿名枚举文件名」。
--
-- ── 收益较低，按需取舍 ──
-- 这些桶本就是 public、文件内容凭 URL 即可匿名 GET，枚举到文件名的实际危害很低。
-- 若你不想冒任何面向用户的风险，跳过本项亦可（核心加固已在另一文件完成）。
-- ============================================================

drop policy if exists "Allow public read access" on storage.objects;  -- qual=true，覆盖所有桶
drop policy if exists "允许公开访问图片"        on storage.objects;  -- qual=(bucket_id='post-images')


-- ============================================================
-- 执行后【必须立即验证】这四件事（任一异常 → 立刻用下方回滚段恢复）：
--   ① 头像：随便打开一个用户主页 / 帖子卡，头像正常显示
--   ② 帖子图：打开带图的帖子，图片正常显示
--   ③ 下载：访问 /download，点 APK 能正常下载
--   ④ 上传：发一条带图的帖子，能上传成功并显示
-- ============================================================

-- ── 回滚（如有异常，整段执行即可恢复原状）──
-- create policy "Allow public read access" on storage.objects
--   for select to public using (true);
-- create policy "允许公开访问图片" on storage.objects
--   for select to public using (bucket_id = 'post-images');
