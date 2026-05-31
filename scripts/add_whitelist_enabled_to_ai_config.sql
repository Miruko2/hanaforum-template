-- 给 ai_config 表加一列：是否启用 hanako 对话白名单
-- true（默认） = 只有 hanako_allowed_users 中的用户能与 hanako 对话（保持现状）
-- false        = 任何登录用户都能与 hanako 对话（仍受 rate_limit 限制）
--
-- 默认值取 true 是为了让本次迁移"零行为变化"：上线后白名单不会被意外解锁。
-- 管理员要放开时，在管理面板把开关关掉即可，最多 10 秒（ai_config 缓存 TTL）后全网生效。
ALTER TABLE ai_config
  ADD COLUMN IF NOT EXISTS whitelist_enabled BOOLEAN NOT NULL DEFAULT true;
