// lib/mengmegzi/constants.ts
//
// 萌萌子 Agent 常量。与 lib/hanako/constants.ts 的 MENGMEGZI_USER_ID 保持一致。

/** 萌萌子的固定用户 ID（与 lib/hanako/constants.ts 的 MENGMEGZI_USER_ID 一致）。
 *  通过环境变量 MENGMEGZI_USER_ID 配置。 */
export const MENGMEGZI_USER_ID = process.env.MENGMEGZI_USER_ID || ""

/** 所有合法分类（与 lib/categories.ts 的 CATEGORIES value 对齐） */
export const ALL_CATEGORIES = ["general", "nsfw", "game", "code", "life", "help"] as const
export type AgentCategory = (typeof ALL_CATEGORIES)[number]

/** 发帖温度（多样性） */
export const POST_TEMPERATURE = 0.9
/** 留言/回复温度（贴合语境） */
export const COMMENT_TEMPERATURE = 0.7

/** max_tokens（复用 hanako 的 MAX_REPLY_TOKENS，覆盖推理模型思考链） */
export const MAX_AGENT_TOKENS = 4000

/** 萌萌子发帖/留言/回复带表情包的目标概率（对齐私信 DM_STICKER_INJECT_PROBABILITY=0.55）。
 *  prompt 已引导「适当用」，但模型偏保守，故按此概率在上下文末尾临时注入一条「本轮配个表情包」
 *  的 system 提示推高命中率。该提示只活本次请求、不写库。0.5 ≈ 一半动作带表情包，活泼不刷屏。 */
export const STICKER_INJECT_PROBABILITY = 0.5

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

/** booru 配图通用黑名单（所有分类都拦，绝对红线）：post 的 tag_string 命中任一即丢弃。
 *  loli/shota/guro 等是任何分类（含色图软色情）都不可逾越的红线；nude/nipples/pussy 等是
 *  基础露点词。下划线词边界匹配（见 image-sources.tagHitsAny），故 "cum" 命中 "cum_on_body"、
 *  "sex" 命中 "group_sex"，但不误伤 "cumulus"/"sexy"。 */
export const BOORU_TAG_BLOCKLIST = [
  "loli", "lolicon", "shota", "shotacon", "toddlercon",
  "nude", "nipples", "pussy", "penis", "sex", "cum", "anus",
  "guro", "gore",
] as const

/**
 * 色图(nsfw)分类「软色情·不露点」额外黑名单：在 BOORU_TAG_BLOCKLIST 之外，再屏蔽一切
 * 露点/性行为 tag，确保只出「性感但不露点」（swimsuit/bikini/lingerie/cleavage 放行）。
 * 配 yande.re rating:q（较宽、可能含露点）时尤其关键。词边界匹配，故 "anal" 命中 "anal_sex"。
 * 注意：绝不包含 "breasts"（几乎每张女性图都有、会清空结果），只拦真正暴露的 breasts_out 等。
 */
export const SUGGESTIVE_EXTRA_BLOCK = [
  // 露点（暴露乳头/生殖器）
  "nipple", "areola", "areolae", "topless", "bottomless", "naked",
  "completely_nude", "partially_nude", "breast_out", "breasts_out",
  "nipple_slip", "uncensored", "pubic", "vagina", "vaginal", "clitoris",
  // 性行为
  "anal", "oral", "fellatio", "cunnilingus", "paizuri", "handjob",
  "masturbation", "cumshot", "creampie", "ejaculation", "penetration",
  "dildo", "vibrator", "bondage", "rape", "bestiality",
  // 其他越界
  "futanari",
] as const

/** 默认 image_sources（代码里用于回退；DB 里以 mengmegzi_config.image_sources 为准）。
 *  二次元论坛用 danbooru/yande.re 动漫图：query 字段 = AI 关键词搜不到时的「回退 booru tag」。
 *  · 安全分类(general/game/life)：provider "danbooru"（danbooru g + yande.re s 双源）。
 *  · 色图(nsfw)：provider "suggestive"（danbooru s + yande.re q 双源·软色情不露点）。
 *  · code/help 走 none（不配图）。 */
export const DEFAULT_IMAGE_SOURCES = {
  general: { provider: "danbooru", query: "original" },
  nsfw: { provider: "suggestive", query: "swimsuit" },
  game: { provider: "danbooru", query: "video_game" },
  code: { provider: "none" },
  life: { provider: "danbooru", query: "scenery" },
  help: { provider: "none" },
} as const
