-- ============================================================
-- 修复：注册后用户名被存成「邮箱」
-- ============================================================
-- 根因：handle_new_user() 触发器在 auth.users 插入时，直接把 NEW.email
--       当 username 写进 public.profiles（无视注册传入的
--       raw_user_meta_data.username），且先于前端 signUp 的正确写入执行
--       —— 前端随后的 profiles.insert 因主键 id 冲突失败（代码里被 catch 忽略），
--       于是 profiles.username 永久保留邮箱。每个新注册用户都会中招。
--
-- 本脚本两步，在 Supabase → SQL Editor 整段执行：
--   ① 重建触发器函数：今后用真实用户名，绝不再用 email；
--   ② 回填存量：把已存成邮箱的 profiles.username 改回真名。
-- 可重复执行（幂等）。
-- ============================================================

-- ── ① 重建触发器函数：优先注册传入的 username，没有才用占位名，绝不用 email ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $function$
DECLARE
  base_name text;
  final_name text;
  n int := 0;
BEGIN
  -- 注册时前端通过 options.data.username 写入 raw_user_meta_data
  base_name := NULLIF(trim(NEW.raw_user_meta_data->>'username'), '');
  -- 兜底占位名（绝不用邮箱）；万一 metadata 里也是邮箱也不采用
  IF base_name IS NULL OR base_name LIKE '%@%' THEN
    base_name := '用户_' || substr(NEW.id::text, 1, 6);
  END IF;

  -- username 有 UNIQUE 约束：撞名加数字后缀，避免 INSERT 失败导致整个注册回滚
  final_name := base_name;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_name) LOOP
    n := n + 1;
    final_name := base_name || '_' || n;
  END LOOP;

  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, final_name)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- ── ② 回填存量：profiles.username 是邮箱的 → 改回真名 ──
-- 真名来源优先级（只取「非空且不含 @」的）：
--   auth.users metadata.username → user_profiles.username → 占位名「用户_xxxxxx」。
-- 逐行处理 + 撞名加数字后缀：既避开已有用户名，也避开「本批多个邮箱算出同名」互撞
-- （username 有 UNIQUE 约束，单条批量 UPDATE 防不住同批重名，故用 PL/pgSQL 循环）。
DO $$
DECLARE
  rec RECORD;
  base_name text;
  final_name text;
  n int;
BEGIN
  FOR rec IN
    SELECT p.id,
           u.raw_user_meta_data->>'username' AS meta_name,
           up.username AS up_name
    FROM public.profiles p
    LEFT JOIN auth.users u            ON u.id = p.id
    LEFT JOIN public.user_profiles up ON up.user_id = p.id
    WHERE p.username LIKE '%@%'
  LOOP
    IF rec.meta_name IS NOT NULL AND trim(rec.meta_name) <> '' AND rec.meta_name NOT LIKE '%@%' THEN
      base_name := trim(rec.meta_name);
    ELSIF rec.up_name IS NOT NULL AND trim(rec.up_name) <> '' AND rec.up_name NOT LIKE '%@%' THEN
      base_name := trim(rec.up_name);
    ELSE
      base_name := '用户_' || substr(rec.id::text, 1, 6);
    END IF;

    final_name := base_name;
    n := 0;
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_name AND id <> rec.id) LOOP
      n := n + 1;
      final_name := base_name || '_' || n;
    END LOOP;

    UPDATE public.profiles SET username = final_name WHERE id = rec.id;
  END LOOP;
END $$;

-- ── ③ 自查：跑完后应为空（若仍有，多是撞名被跳过，单独处理） ──
-- SELECT id, username FROM public.profiles WHERE username LIKE '%@%';
