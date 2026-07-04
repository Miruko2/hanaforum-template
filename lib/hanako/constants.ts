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

/** 表情包 id → 心情描述（**仅表情包代码消费**，弹幕墙情绪系统不读它）。
 *  发的表情包 content 即表情 id（如 "happy"）。为了让 AI 读懂表情包背后的心绪而不依赖
 *  图像理解，把表情包转成「[发了XX表情：心情]」文本纳入上下文。未知值兜底为「表情」。
 *  键是「归一后」的规范 id（见 EMOTION_ALIASES），故只列规范 id。 */
export const EMOTION_LABELS: Record<string, string> = {
  neutral: "平静",
  happy: "开心",
  shy: "害羞",
  jealous: "吃醋",
  cuddle: "贴贴/抱抱",
  sleepy: "困倦",
  excited: "兴奋",  // 原 surprised.jpg 实为兴奋表情，已更名 excited
  confused: "疑惑", // 原 worried.jpg 实为疑惑表情，已更名 confused
}

/** 旧表情包 id → 新 id 的别名映射，兼容历史数据（dm_messages 的 sticker content /
 *  帖子·评论里的 [s:xxx] token 残留的旧值）。**仅表情包代码经 normalizeEmotion 使用**。
 *  - yandere → cuddle（语义从「病娇」改为「贴贴/抱抱」）
 *  - surprised → excited、worried → confused：表情图实际画的是兴奋/疑惑，已更名。
 *  ⚠️ surprised / worried 仍是弹幕墙 hanako 的有效「情绪」（见 HanakoEmotion / EMOTIONS /
 *  EMOTION_COLORS / prompt.ts）——弹幕墙从不调用 normalizeEmotion，故这些别名只影响
 *  表情包、绝不影响她的情绪表达。 */
export const EMOTION_ALIASES: Record<string, string> = {
  yandere: "cuddle",
  surprised: "excited",
  worried: "confused",
}

/** 把任意表情包 id（含旧别名）归一到当前规范 id；未知值原样返回。 */
export function normalizeEmotion(id: string): string {
  return EMOTION_ALIASES[id] ?? id
}

/** 把表情包 id 转成上下文里可读的心情文本（未知兜底「表情」，兼容旧别名）。 */
export function emotionLabel(id: string): string {
  return EMOTION_LABELS[normalizeEmotion(id)] || "表情"
}

/** Hanako 的固定用户 ID（对应 auth.users 和 public.users 中的记录）。
 *  通过环境变量 HANAKO_USER_ID 配置（见 scripts/create-mengmegzi-account.mjs 的建号流程）。 */
export const HANAKO_USER_ID = process.env.HANAKO_USER_ID || ""

/** Hanako 的用户名（弹幕墙场景用，保持 hanako 不变） */
export const HANAKO_USERNAME = "hanako"

/** 私信 AI「萌萌子」的固定用户 ID（独立第二个 auth 账号，与 hanako 彻底分离）。
 *  账号由 scripts/create-mengmegzi-account.mjs 创建（email: mengmegzi@ai.local）。
 *  萌萌子只服务私信；弹幕墙仍由 hanako 独占。两者各自独立会话历史/人格记忆。
 *  通过环境变量 MENGMEGZI_USER_ID 配置。 */
export const MENGMEGZI_USER_ID = process.env.MENGMEGZI_USER_ID || ""

/** 私信 AI（萌萌子）的展示名。私信/弹窗/主页等「私聊面向」一律用此名。 */
export const HANAKO_DM_USERNAME = "萌萌子"

/** 私信 AI（萌萌子）的展示头像。profiles 行可能无头像，故用站点内置资源覆盖。
 *  私信面板 / 来信弹窗 / 主页头像统一用此路径，保证三处一致。 */
export const HANAKO_AVATAR = "/hanako/avatar.png"

/** 触发 AI 回复的正则（不区分大小写） */
export const TRIGGER_REGEX = /@hanako|@花子/i

/** 大厅里 @萌萌子 的触发正则（不区分大小写）。命中即必回，绕过概率掷骰与服务端冷却。 */
export const HALL_MENTION_REGEX = /@萌萌子|@mengmegzi/i

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
 * 设 4000：1500 时推理模型在"需要先搜索再组织长内容"的场景（如剧透/讲解）
 * 会把预算全用在 thinking 上、正文输出为空，导致 parseReplies 拿到空串 → 500 静默。
 * 提到 4000 让 thinking 有余量、正文也能输出。max_tokens 只是上限，日常闲聊
 * 模型实际用 50~150 token 就 EOS 了，不会因为上限高就多花钱。
 */
export const MAX_REPLY_TOKENS = 4000

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

/** 萌萌子单轮回复带表情包的目标概率。
 *  prompt 已引导「频繁发」，但模型（尤其 deepseek-chat）偏保守、常不够主动；
 *  故在发给模型的上下文末尾按此概率临时注入一条「本轮配个表情包」的 system 提示，
 *  推高实际命中率。该提示只存在于本次请求、不写库、不污染历史记忆。
 *  0.55 ≈ 一半多回复带表情包：活泼有萌点但不刷屏。可随时调。 */
export const DM_STICKER_INJECT_PROBABILITY = 0.55

/* ============================================================
 * 萌萌子在大厅（chat_messages）主动插话参数
 *
 * 机制（稳重陪聊档）：前端订阅大厅 realtime。为避免「用户一个意思拆成几句发、每句
 * 都被接话」，不再每来一条就掷骰，而是等大厅停顿 HALL_CHIME_IN_DEBOUNCE_MS（确认这
 * 一段说完）后，对整段按 HALL_CHIME_IN_PROBABILITY 掷一次骰，命中才调 /api/hall-mengmegzi。
 * 连发的多条消息只会不断重置该定时器，故整段只触发一次。被 @ 点名（HALL_MENTION_REGEX）
 * 绕过去抖与概率，立即必回。萌萌子自己的发言不触发（防递归）。服务端叠一道时间冷却防
 * 多客户端并发刷屏；且单次回复在路由层截断为「一句话 + 至多一个表情」，不再连珠炮。
 * ============================================================ */

/** 客户端：大厅停顿后掷骰、触发萌萌子主动发言的概率。0.2 ≈ 稳重陪聊（不抢话、不刷屏）。 */
export const HALL_CHIME_IN_PROBABILITY = 0.2

/** 客户端去抖：大厅最后一条消息后，等这么久（毫秒）没再来新消息，才算「这一段说完」再掷骰。
 *  5s：用户连发的几句话会不断重置它，停笔后才触发一次，根除「每句都被接话」。 */
export const HALL_CHIME_IN_DEBOUNCE_MS = 5_000

/** 服务端冷却：萌萌子在大厅两次发言间的最小间隔（毫秒）。防多客户端并发命中刷屏。
 *  15s：稳重陪聊但不过分慢热。多个在线用户同时命中时，只有距上次发言满 15s 的才放行。
 *  注意：被 @ 点名（force=true）绕过此冷却，保证必回。 */
export const HALL_CHIME_IN_COOLDOWN_MS = 15_000

/** 拉大厅最近多少条消息作为上下文（含触发消息）。控制单次 token 成本。 */
export const HALL_CHIME_IN_CONTEXT_MSGS = 20

/** 萌萌子单次大厅插话的上限（路由层截断）：一次最多几句文字 + 几个表情，按模型原顺序
 *  穿插收集、各自超出即丢弃。3 句 + 2 表情：保留一点连贯表达，又不至于连珠炮刷屏。可随时调。 */
export const HALL_REPLY_MAX_TEXTS = 3
export const HALL_REPLY_MAX_STICKERS = 2

// 白名单从数据库表 hanako_allowed_users 读取（见 app/api/ai-reply/route.ts）
