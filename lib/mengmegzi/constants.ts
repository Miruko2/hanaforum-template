// lib/mengmegzi/constants.ts
//
// 萌萌子 Agent 常量。与 lib/hanako/constants.ts 的 MENGMEGZI_USER_ID 保持一致。

/** 萌萌子的固定用户 ID（与 lib/hanako/constants.ts 的 MENGMEGZI_USER_ID 一致） */
export const MENGMEGZI_USER_ID = "78257113-e5da-4bcb-bb7a-9b1824439cd1"

/** 所有合法分类（与 lib/categories.ts 的 CATEGORIES value 对齐） */
export const ALL_CATEGORIES = ["general", "nsfw", "game", "code", "life", "help"] as const
export type AgentCategory = (typeof ALL_CATEGORIES)[number]

/** 发帖温度（多样性） */
export const POST_TEMPERATURE = 0.9
/** 留言/回复温度（贴合语境） */
export const COMMENT_TEMPERATURE = 0.7

/** max_tokens（复用 hanako 的 MAX_REPLY_TOKENS，覆盖推理模型思考链） */
export const MAX_AGENT_TOKENS = 4000

/** 图片压缩参数（与客户端 lib/image-compress.ts 一致：maxEdge 1920 / quality 0.82 / webp） */
export const IMAGE_MAX_EDGE = 1920
export const IMAGE_QUALITY = 82

/** Storage 桶名 + 路径前缀（萌萌子发的帖的图单独放一个前缀目录，方便日后清理） */
export const POSTS_BUCKET = "post-images"
export const MENGMEGZI_STORAGE_PREFIX = "mengmegzi"

/** 默认 image_sources（与表里的初始值一致；代码里用于校验/回退）。
 *  nsfw 走 none（不配图，露点内容不接入）。 */
export const DEFAULT_IMAGE_SOURCES = {
  general: { provider: "unsplash", query: "daily life" },
  nsfw: { provider: "none" },
  game: { provider: "unsplash", query: "video game" },
  code: { provider: "none" },
  life: { provider: "unsplash", query: "lifestyle" },
  help: { provider: "none" },
} as const
