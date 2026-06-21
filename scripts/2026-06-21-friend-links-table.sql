-- 友链表 friend_links：把 /links 的友链从「page.tsx 硬编码数组」搬进数据库，
-- 以便在管理面板可视化增删改 + 一键审核申请上墙。
-- ============================================================
-- 两个分区共用一张表，靠 category 区分：
--   'friend' = 朋友的小站（反链 / 申请审核通过的落这里）
--   'nav'    = 二次元·ACG 导航（对外投收录的清单）
-- /links 仍是服务端组件、用 anon key 读「可见」行、SSR 进 HTML（收录爬虫照读）。
-- 写入一律走管理端 API（service_role 绕 RLS）。
--
-- 在 Supabase 控制台 → SQL Editor 整段执行即可。幂等：表已建则跳过；种子仅在表为空时灌。
-- ============================================================

-- 1) 友链表
CREATE TABLE IF NOT EXISTS public.friend_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  url         text NOT NULL,
  description text,
  icon_url    text,
  tag         text,                          -- 可选小标签（如「前端 · 技术博客」）
  category    text NOT NULL DEFAULT 'friend' CHECK (category IN ('friend', 'nav')),
  sort_order  int  NOT NULL DEFAULT 0,        -- 同分区内升序
  is_visible  boolean NOT NULL DEFAULT true,  -- 下架 = false（仍在库、不在页面显示）
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_friend_links_cat_sort ON public.friend_links (category, sort_order);
CREATE INDEX IF NOT EXISTS idx_friend_links_visible  ON public.friend_links (is_visible);

-- 2) RLS：公开可读「可见」行（/links 用 anon key 读）；管理员可读写全部。
--    实际写入走 service_role API（绕 RLS），下面的管理员策略是双保险。
ALTER TABLE public.friend_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "友链公开可读(仅可见)" ON public.friend_links;
CREATE POLICY "友链公开可读(仅可见)" ON public.friend_links
  FOR SELECT USING (is_visible = true);

DROP POLICY IF EXISTS "友链管理员全权" ON public.friend_links;
CREATE POLICY "友链管理员全权" ON public.friend_links
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid()));

-- 3) 申请表加一列：审核通过时记下生成的友链 id（审计 + 防重复通过）
ALTER TABLE public.friend_link_submissions
  ADD COLUMN IF NOT EXISTS approved_link_id uuid
  REFERENCES public.friend_links(id) ON DELETE SET NULL;

-- 4) 种子：把当前 page.tsx 里的友链迁进来（仅当表为空时执行，幂等）。
--    friend 分区 = 朋友的小站；nav 分区 = 二次元·ACG 导航（与现页面顺序一致）。
INSERT INTO public.friend_links (name, url, description, tag, category, sort_order)
SELECT v.name, v.url, v.description, v.tag, v.category, v.sort_order
FROM (VALUES
  ('Ar-Sr-Na 主站', 'https://arsrna.cn/',        '创意，从一条时间轴开始', '科技 · 官网',     'friend', 0),
  ('Ar-Sr-Na',      'https://www.arirs.cn/',      '就是放文章的地方',       '前端 · 技术博客', 'friend', 1),
  ('萌站·次元导航',  'https://www.moe321.com/',    'ACG 二次元网址导航之门',  NULL,             'nav',    0),
  ('ACG 盒子',       'https://www.acgbox.link/',   '专注 ACG 的导航盒子',     NULL,             'nav',    1),
  ('ACGN 导航',      'https://nav.acgn.city/',     'AcgN·City 二次元导航',    NULL,             'nav',    2),
  ('动漫世界导航',   'https://nav.acgsq.com/',     '一起探索二次元动漫',      NULL,             'nav',    3),
  ('终极导航',       'https://www.zjnav.com/acg',  '动漫 · 漫画网站大全',     NULL,             'nav',    4),
  ('快导航网',       'https://www.hifast.cn/acg',  'ACG 二次元导航',          NULL,             'nav',    5),
  ('AcgnHub 萌导航', 'https://www.acgfans.me/',    '你的二次元萌导航姬',      NULL,             'nav',    6),
  ('二次元宝藏导航', 'https://acg.baozangdh.com/', '可能是国内最好的二次元导航', NULL,          'nav',    7),
  ('万萌导航',       'https://hao.wanmoe.cn/',     'ACG · 二次元导航',        NULL,             'nav',    8),
  ('ACG导航站',      'https://www.acgdhz.com/',    '专注 ACG 动漫 · 游戏 · 漫画', NULL,         'nav',    9),
  ('Moe48 萌导航',   'https://www.moe48.com/',     '二次元 · ACG 网址导航',   NULL,             'nav',    10)
) AS v(name, url, description, tag, category, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.friend_links);

-- 5) 自检：看分区计数
SELECT category, count(*) AS n FROM public.friend_links GROUP BY category ORDER BY category;
