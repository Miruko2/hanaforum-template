-- ============================================================
-- 萌萌子论坛头像：补齐 profiles.avatar_url - 2026-06-20
--
-- 现象：论坛里「萌萌子」(MENGMEGZI_USER_ID) 发的帖子 / 评论显示的是默认头像
--       (/logo.png)，而不是她社交主页那张头像。
--
-- 根因：萌萌子账号由 admin API 创建时只写了 user_metadata.username、从未设头像
--       (见 scripts/create-mengmegzi-account.mjs)，故其 profiles.avatar_url 为空。
--   · 社交主页 app/user/page.tsx 对她**前端特判**，强制用站内常量 HANAKO_AVATAR
--     (= /hanako/avatar.png) 显示，所以主页头像是对的。
--   · 但论坛帖子卡 / 评论 / 楼中楼 / 悬浮社交卡 / 关注列表 / 通知都直接读
--     profiles.avatar_url（lib/supabase-optimized.ts、lib/supabase.ts、lib/user-card.ts），
--     该列为空 → 一律回退默认 /logo.png → 「帖子头像 ≠ 社交页头像」。
--
-- 修法：把她的 profiles.avatar_url 补成与社交页一致的站内资源 /hanako/avatar.png
--       (= lib/hanako/constants.ts 的 HANAKO_AVATAR；public/hanako/avatar.png 真实存在)。
--   · 这是相对路径而非 Supabase Storage URL：所有消费点都先过 cdnUrl()（对非 storage
--     路径原样返回）再塞进 <img src>，相对路径在站内可正常加载。avatar_url 列无 https
--     CHECK 约束（只有 background_url/home_background_url 有），故可直接写入。
--   · 一处补值，全部显示路径（含存量旧帖——头像是显示时实时 join 的）立即统一，
--     前端代码零改动、零遗漏。
--
-- 兼容：前端各处「萌萌子 → HANAKO_AVATAR」常量特判一律保留，作为「DB 被清/未跑本脚本」
--       时的双保险，取值与本脚本写入完全一致、互不冲突。
--
-- 在 Supabase Dashboard → SQL Editor 整段执行（幂等，可重复跑；值固定不变）。
-- ⚠️ 若将来在管理端给萌萌子单独上传了别的头像，请勿重跑本脚本（会覆盖回 /hanako/avatar.png）。
-- ============================================================

UPDATE public.profiles
SET avatar_url = '/hanako/avatar.png'
WHERE id = '78257113-e5da-4bcb-bb7a-9b1824439cd1';

-- 验证：应返回 1 行，avatar_url = /hanako/avatar.png。
-- 若返回 0 行 → 萌萌子的 profiles 行不存在（异常，需先排查账号/触发器，再处理）。
SELECT id, username, avatar_url
FROM public.profiles
WHERE id = '78257113-e5da-4bcb-bb7a-9b1824439cd1';
