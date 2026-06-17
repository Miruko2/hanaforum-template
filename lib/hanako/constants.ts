/** Hanako AI 主播系统常量 */

/** 情绪枚举 */
export type HanakoEmotion =
  | "neutral"
  | "happy"
  | "shy"
  | "jealous"
  | "worried"
  | "cuddle"
  | "surprised"
  | "sleepy"

export const EMOTIONS: HanakoEmotion[] = [
  "neutral",
  "happy",
  "shy",
  "jealous",
  "worried",
  "cuddle",
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
  cuddle: "#f87171",    // red
  surprised: "#fde047", // yellow
  sleepy: "#a78bfa",    // purple
}

/** 情绪 id → 心情描述（私信上下文用）。
 *  私信里发的表情包 content 即情绪 id（如 "happy"）。为了让 AI 读懂表情包背后的
 *  心绪而不依赖图像理解，把表情包转成「[发了XX表情：心情]」文本纳入上下文。
 *  覆盖全部 EMOTIONS 枚举，未知值兜底为「表情」。 */
export const EMOTION_LABELS: Record<HanakoEmotion, string> = {
  neutral: "平静",
  happy: "开心",
  shy: "害羞",
  jealous: "吃醋",
  worried: "担心",
  cuddle: "贴贴/抱抱",
  surprised: "惊讶",
  sleepy: "困倦",
}

/** 旧情绪 id → 新 id 的别名映射，兼容历史数据（dm_messages / 帖子 token 里残留的旧值）。
 *  yandere 已更名为 cuddle（语义从「病娇」改为「贴贴/抱抱」，避免模型把 yandere
 *  当病娇理解）。历史消息里存的 yandere 在渲染/解析时归一到 cuddle。 */
export const EMOTION_ALIASES: Record<string, HanakoEmotion> = {
  yandere: "cuddle",
}

/** 把任意情绪 id（含旧别名）归一到当前枚举值；未知值原样返回。 */
export function normalizeEmotion(id: string): string {
  return EMOTION_ALIASES[id] ?? id
}

/** 把情绪 id 转成上下文里可读的心情文本（未知情绪兜底，兼容旧别名）。 */
export function emotionLabel(id: string): string {
  const normalized = normalizeEmotion(id) as HanakoEmotion
  return EMOTION_LABELS[normalized] || "表情"
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

/* ============================================================
 * 私信 AI（萌萌子）上下文压缩参数 ——「记性优先」档
 *
 * 机制：最近 N 条消息原样进上下文（短期记忆）；更老的折叠进摘要（长期记忆）。
 * 压缩一律「从最老的连续往后」折叠，summarized_up_to 连续推进，绝不跳过中间消息
 * （根除按 limit 取最新 N 条导致的「健忘黑洞」）。
 *   - 正常由客户端空闲触发（idle → /api/dm-compress，超 TRIGGER 才真压）；
 *   - 回复热路径默认不压缩，只有堆到 HARD（空闲链路长期没跑）才兜底同步压一次，
 *     正常回复不会因压缩卡顿。
 * 以「消息条数」为主阈值（私聊短消息，比 token 直观且对消息长短鲁棒），
 * 再叠一道 token 预算/上限防极端长消息撑爆每条回复的上下文成本。
 * ============================================================ */

/** 压缩后保留的「最近原文」条数（短期记忆窗口）。"记性优先"档：保留更近的对话原文。 */
export const DM_KEEP_RECENT_MSGS = 80

/** 空闲压缩触发阈值（按未摘要条数）：超过即在空闲时把最老的折叠到只剩 DM_KEEP_RECENT_MSGS 条。 */
export const DM_COMPRESS_TRIGGER_MSGS = 140

/** 回复热路径兜底阈值：仅当未摘要堆到此值（说明空闲链路一直没跑）才在回复前同步压一次，
 *  避免上下文无限增长。正常回复走不到这里，不会卡顿。 */
export const DM_COMPRESS_HARD_MSGS = 200

/** token 预算：保留窗口同时受此 token 上限约束——折叠后剩余未摘要既 ≤ KEEP 条、也 ≤ 此 token。
 *  超长消息时按 token 提前折叠，使每条回复的上下文成本有界。 */
export const DM_COMPRESS_SOFT_TOKENS = 12000

/** 组装后上下文的最终 token 硬上限（最后一道保险，正常走不到）：若未摘要仍超此 token，
 *  仅从「带入上下文」里丢弃最老的（不推进 summarized_up_to，下轮压缩会把它补进摘要）。 */
export const DM_CONTEXT_TOKENS = 16000

/** 单次拉取未摘要历史的行数上限（> HARD 阈值，留足突发余量）。 */
export const DM_FETCH_LIMIT = 400

/** 单次压缩最多折叠多少条进摘要（防极端积压时摘要输入过大）；剩余留到下一轮继续折叠。 */
export const DM_MAX_FOLD_BATCH = 200

/** 生成会话摘要时的最大输出 token。摘要要求精炼（~800 字内），保留关键事实。 */
export const DM_SUMMARY_MAX_TOKENS = 1200

// 白名单从数据库表 hanako_allowed_users 读取（见 app/api/ai-reply/route.ts）
