-- ============================================================
-- 放宽 live_comments 的长度约束，让 hanako 能回更长的内容
-- 在 Supabase Dashboard → SQL Editor 里整段执行一次
-- ============================================================
--
-- 背景：原表有 CHECK (char_length(content) <= 60)，给普通用户弹幕设计的。
-- hanako（service role 写入）也走同一张表、同样受这道 CHECK 约束
-- （service role 只绕 RLS，不绕 CHECK）。她一旦回复超过 60 字，
-- INSERT 直接失败、被前端静默吞掉——别的观众在弹幕流里根本看不到。
--
-- 方案：按 user_id 区分上限——
--   hanako（固定 UUID）→ 最多 500 字
--   其他所有用户        → 仍然最多 60 字（弹幕墙保持简短，前端输入框也限 50）
--
-- 注：原 CHECK 是建表时内联的匿名约束，名字由 Postgres 自动生成
-- （通常是 live_comments_content_check）。下面的 DO 块会把表上所有
-- CHECK 约束都找出来删掉（这张表本来也只有这一条），再加回命名版本，
-- 避免因约束名不确定而失败。可重复执行。

DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.live_comments'::regclass
      AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.live_comments DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.live_comments
  ADD CONSTRAINT live_comments_content_len
  CHECK (
    char_length(content) > 0
    AND char_length(content) <= (
      CASE
        WHEN user_id = 'HANAKO_USER_ID'::uuid THEN 500
        ELSE 60
      END
    )
  );

COMMENT ON CONSTRAINT live_comments_content_len ON public.live_comments
  IS 'hanako(固定UUID，⚠️改成你的 HANAKO_USER_ID)最多500字，其余用户最多60字';
