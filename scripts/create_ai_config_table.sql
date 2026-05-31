-- 创建 ai_config 表，用于动态管理弹幕墙 AI 的 base_url / api_key / model
-- 设计上是"单行表"：所有调用都读 id=1 这一行
CREATE TABLE IF NOT EXISTS ai_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_url TEXT NOT NULL DEFAULT 'https://api.deepseek.com/v1',
  api_key TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'deepseek-chat',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID
);

-- 启用 RLS，不写任何 policy → 客户端读不到（只有 service_role 能绕过 RLS）
-- 这样可以保证 api_key 不会被前端或匿名用户拉到
ALTER TABLE ai_config ENABLE ROW LEVEL SECURITY;

-- 插入默认行（如果还没有）
-- 注意：api_key 留空，需要管理员在管理面板填入后才能用 DB 配置；
-- 在那之前，ai-reply 路由会 fallback 到环境变量
INSERT INTO ai_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
