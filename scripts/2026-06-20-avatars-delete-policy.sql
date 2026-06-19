-- ============================================================
-- avatars 桶：允许登录用户删除「自己 {userId}/ 前缀」下的对象 - 2026-06-20
--
-- 背景：换头像 / 换 banner / 换或还原首页背景时，前端会 best-effort 删掉旧文件
--       （lib/profiles.ts 的 removeOldAvatarObject），避免每次换图都在桶里堆一个孤儿。
--       删除走 storage.objects 的 RLS —— 默认没有 DELETE 策略时删会被拒（前端已容错忽略，
--       但旧文件就删不掉、继续残留）。本策略仅放行「删自己前缀」，绝不影响他人文件。
--
-- 路径约定：头像 {userId}/{ts}.webp、banner {userId}/bg_{ts}.webp、首页背景
--           {userId}/homebg_{ts}.webp —— 第一段都是 userId，故按 foldername[1] 判主。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行（幂等，可重复跑）。
-- ⚠️ 仅当你要「换图自动清理旧文件」时才需要跑；不跑也不报错，只是旧文件继续残留为孤儿。
-- ============================================================

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
