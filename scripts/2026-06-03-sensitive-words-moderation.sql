-- ============================================================
-- 敏感词文本审核（先发后审）- 2026-06-03
-- 配套 Edge Function: supabase/functions/moderate-text
--
-- 作用：帖子/评论/弹幕发出后，由数据库 Webhook 触发 moderate-text，
--      把内容比对本表词库（目前只装政治类），命中则删内容 + 通知作者。
--
-- 词库本身【不进代码仓库】，由 scripts/seed-sensitive-words.mjs 生成
-- 一份本地 .sql（已 gitignore），你在 SQL Editor 里执行那份来灌词。
--
-- 在 Supabase Dashboard → SQL Editor 里整段执行一次（幂等，可重复跑）。
-- ============================================================

-- 1) 词库表
CREATE TABLE IF NOT EXISTS public.sensitive_words (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  word       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '政治',
  enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2) 按 lower(word) 唯一：避免 xjp / XJP 这类拼音缩写大小写重复
CREATE UNIQUE INDEX IF NOT EXISTS sensitive_words_word_lower_key
  ON public.sensitive_words (lower(word));

-- 3) RLS：只有管理员能读写。Edge Function 用 service_role，自动绕过 RLS 不受影响。
--    （前端任何普通用户都不该能读到这份词库，否则等于公开了规避指南）
ALTER TABLE public.sensitive_words ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sensitive_words_admin_all ON public.sensitive_words;
CREATE POLICY sensitive_words_admin_all ON public.sensitive_words
  FOR ALL
  USING      (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

COMMENT ON TABLE public.sensitive_words IS '文本审核敏感词库（私有，仅管理员/服务端可见）';

-- ============================================================
-- 部署清单（代码 + SQL 之外，还需在控制台做这几步）：
--
-- A. 部署函数 moderate-text：
--    npx supabase functions deploy moderate-text
--    （或在控制台新建函数粘贴 supabase/functions/moderate-text/index.ts）
--    然后在函数 Settings 里把 "Verify JWT" 关掉。
--
-- B. 配置密钥（函数 Secrets，复用 moderate-image 已有的那个）：
--    MODERATION_WEBHOOK_SECRET = <和 moderate-image 同一个值>
--    （SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由平台自动注入，无需手填）
--
-- C. 建 3 个数据库 Webhook（Dashboard → Database → Webhooks → Create）：
--    指向 moderate-text 函数的 URL，方法 POST，
--    都加一个请求头：  x-moderation-secret = <上面那个密钥>
--      1) 表 posts          事件 Insert + Update
--      2) 表 comments       事件 Insert + Update
--      3) 表 live_comments  事件 Insert
--    （live_comments 不可编辑，只需 Insert）
--
-- D. 灌词：
--    本机跑  node scripts/seed-sensitive-words.mjs
--    它会生成 scripts/seed-sensitive-words.generated.sql（已 gitignore），
--    把那份内容贴进 SQL Editor 执行即可。
--
-- 验证：发一条含政治敏感词的测试帖/评论/弹幕，几秒内应被删除，
--      作者收到一条"内容被移除"通知（弹幕默认不通知，可在函数里改 NOTIFY_DANMU）。
-- ============================================================
