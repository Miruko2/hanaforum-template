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

/** 主图压缩参数（与客户端 lib/image-compress.ts 一致：maxEdge 1920 / quality 82 / webp）。
 *  现走 Unsplash imgix URL 参数（&w=&h=&fit=max&fm=webp&q=）下载即压好，不再用 sharp。 */
export const IMAGE_MAX_EDGE = 1920
export const IMAGE_QUALITY = 82

/** Storage 桶名（与真人发帖同桶 post-images） */
export const POSTS_BUCKET = "post-images"
/**
 * 萌萌子图的文件名前缀（注意：是「前缀」不是「子目录」）。
 * 存桶根目录、用连字符拼成 `mengmegzi-<id>.webp`——既能一眼认出/批量清理，
 * 又满足缩略图约定 postThumbUrl 对「路径不含 /」的要求：子目录会让它直接返回 null，
 * 卡片永远拿不到 640px 缩略图、退而加载全尺寸主图烧 egress。
 */
export const MENGMEGZI_STORAGE_PREFIX = "mengmegzi"

/** booru 配图 nsfw 二次过滤黑名单：post 的 tag_string 命中任一即丢弃。
 *  `rating:g` 已排除露点/性感，但 loli/shota 等年龄向 tag 即使 g 级也可能经匿名 API 返回
 *  （danbooru issue #2096），必须事后过滤。见 image-sources.fetchFromDanbooru。 */
export const BOORU_TAG_BLOCKLIST = [
  "loli", "lolicon", "shota", "shotacon", "toddlercon",
  "nude", "nipples", "pussy", "penis", "sex", "cum", "anus",
  "guro", "gore",
] as const

/** 默认 image_sources（代码里用于回退；DB 里以 mengmegzi_config.image_sources 为准）。
 *  二次元论坛改用 danbooru 动漫图：query 字段 = AI 关键词搜不到时的「回退 booru tag」。
 *  nsfw/code/help 走 none（不配图）。 */
export const DEFAULT_IMAGE_SOURCES = {
  general: { provider: "danbooru", query: "original" },
  nsfw: { provider: "none" },
  game: { provider: "danbooru", query: "video_game" },
  code: { provider: "none" },
  life: { provider: "danbooru", query: "scenery" },
  help: { provider: "none" },
} as const
