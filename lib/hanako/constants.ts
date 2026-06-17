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

/** Hanako 的用户名（弹幕墙场景用，保持 hanako 不变） */
export const HANAKO_USERNAME = "hanako"

/** 私信 AI 的展示名（与弹幕墙解耦：私信里叫「萌萌子」）。
 *  同一个用户身份（HANAKO_USER_ID），仅在私信/弹窗/主页等「私聊面向」展示时用此名。 */
export const HANAKO_DM_USERNAME = "萌萌子"

/** 私信 AI 的展示头像。她是 AI、profiles 行可能无头像，故用站点内置资源覆盖。
 *  私信面板 / 来信弹窗 / 主页头像统一用此路径，保证三处一致。 */
export const HANAKO_AVATAR = "/hanako/avatar.png"

/** 触发 AI 回复的正则（不区分大小写） */
export const TRIGGER_REGEX = /@hanako|@花子/i

/** 每用户同时在飞的最大 AI 请求数 */
export const USER_MAX_CONCURRENT = 1

/** 全局同时在飞的最大 AI 请求数 */
export const GLOBAL_MAX_CONCURRENT = 2

/** AI 回复最大 token
 *
 * 这个值要覆盖"模型实际输出 + 推理模型的内部思考链"两部分。
 * - 非推理模型（deepseek-chat / gpt-4o-mini 等）：实际只用 50~150 token
 * - 推理模型（mimo / deepseek-reasoner / R1 / o1 / Qwen-QwQ 等）：
 *   思考链常占 500~1500 token，再加上最终 JSON 输出
 *
 * 设 1500 是兼顾"推理模型也能跑通"的稳妥值。
 * 提示词里明确要求 1~3 句话回复，实际不会因为上限高就生成很长内容。
 * 真要超长，模型也会被 EOS / JSON 闭合提前终止。
 */
export const MAX_REPLY_TOKENS = 1500

// 白名单从数据库表 hanako_allowed_users 读取（见 app/api/ai-reply/route.ts）
