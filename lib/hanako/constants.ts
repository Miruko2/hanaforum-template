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

/** 私信 AI「萌萌子」的固定用户 ID（独立第二个 auth 账号，与 hanako 彻底分离）。
 *  账号由 scripts/create-mengmegzi-account.mjs 创建（email: mengmegzi@ai.local）。
 *  萌萌子只服务私信；弹幕墙仍由 hanako 独占。两者各自独立会话历史/人格记忆。 */
export const MENGMEGZI_USER_ID = "78257113-e5da-4bcb-bb7a-9b1824439cd1"

/** 私信 AI（萌萌子）的展示名。私信/弹窗/主页等「私聊面向」一律用此名。 */
export const HANAKO_DM_USERNAME = "萌萌子"

/** 私信 AI（萌萌子）的展示头像。profiles 行可能无头像，故用站点内置资源覆盖。
 *  私信面板 / 来信弹窗 / 主页头像统一用此路径，保证三处一致。 */
export const HANAKO_AVATAR = "/hanako/avatar.png"

/** 触发 AI 回复的正则（不区分大小写） */
export const TRIGGER_REGEX = /@hanako|@花子/i

/** 每用户同时在飞的最大 AI 请求数 */
export const USER_MAX_CONCURRENT = 1

/** 全局同时在飞的最大 AI 请求数 */
export const GLOBAL_MAX_CONCURRENT = 2

/** 私信 AI（萌萌子）每用户同时在飞的最大请求数。
 *  比弹幕墙宽松：连发多条回复时同一用户会短暂并发。 */
export const DM_USER_MAX_CONCURRENT = 2

/** 私信 AI（萌萌子）全局同时在飞的最大请求数。
 *  独立于弹幕墙的 GLOBAL_MAX_CONCURRENT，两者互不挤占。 */
export const DM_GLOBAL_MAX_CONCURRENT = 4

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

/** 私信 AI（萌萌子）上下文滑动窗口的 token 上限。
 *  从最新消息往前累加 token，窗口内的消息原样进上下文；超出窗口的旧消息
 *  触发自动摘要（压缩成长期记忆），不再原样带入。充分利用长上下文模型。 */
export const DM_CONTEXT_TOKENS = 32768

/** 生成会话摘要时的最大输出 token。摘要要求精炼（~800 字内），保留关键事实。 */
export const DM_SUMMARY_MAX_TOKENS = 1200

// 白名单从数据库表 hanako_allowed_users 读取（见 app/api/ai-reply/route.ts）
