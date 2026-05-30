/** Hanako AI 主播系统常量 */

/** 情绪枚举 */
export type HanakoEmotion =
  | "neutral"
  | "happy"
  | "shy"
  | "jealous"
  | "worried"
  | "yandere"
  | "surprised"
  | "sleepy"

export const EMOTIONS: HanakoEmotion[] = [
  "neutral",
  "happy",
  "shy",
  "jealous",
  "worried",
  "yandere",
  "surprised",
  "sleepy",
]

/** 情绪对应的霓虹颜色（用于前端显示） */
export const EMOTION_COLORS: Record<HanakoEmotion, string> = {
  neutral: "#67e8f9",   // cyan
  happy: "#a3e635",     // lime
  shy: "#f9a8d4",       // pink
  jealous: "#fbbf24",   // amber
  worried: "#93c5fd",   // blue
  yandere: "#f87171",   // red
  surprised: "#fde047", // yellow
  sleepy: "#a78bfa",    // purple
}

/** Hanako 的固定用户 ID（对应 auth.users 和 public.users 中的记录） */
export const HANAKO_USER_ID = "a3015a8e-9f17-4716-bac2-b8cfeb636a23"

/** Hanako 的用户名 */
export const HANAKO_USERNAME = "hanako"

/** 触发 AI 回复的正则（不区分大小写） */
export const TRIGGER_REGEX = /@hanako|@花子/i

/** 每用户同时在飞的最大 AI 请求数 */
export const USER_MAX_CONCURRENT = 1

/** 全局同时在飞的最大 AI 请求数 */
export const GLOBAL_MAX_CONCURRENT = 2

/** AI 回复最大 token（JSON 包装本身约占 20 token，留够 reply 空间） */
export const MAX_REPLY_TOKENS = 300

// 白名单从数据库表 hanako_allowed_users 读取（见 app/api/ai-reply/route.ts）
