// 萌萌子主动私信触发器：cron 每 5 分钟扫描在线用户，按护栏给通过的用户发零 token 模板开场白。
//
// 设计要点（见 docs/superpowers/specs/2026-06-18-mengmegzi-proactive-dm-design.md）：
//   - 开场白走模板不调 LLM，省 token；用户回复后才进真实 AI 对话
//   - 硬过滤未验证用户（他们连回复萌萌子都会被 dm_messages 触发器拦）
//   - 护栏：opted_out / cooldown / max_unanswered / 近冷却期已有消息
//   - DB 逻辑在 worker 里用裸 fetch 打 Supabase REST（worker 无 supabase-js 依赖）

// ── 开场白模板（与 lib/hanako/dm-ai.ts:140 的 OPENER_TEMPLATES 保持一致；两处需同步） ──
// worker 不能 import Next.js 代码，故复制一份。模板极少改动。
export const OPENER_TEMPLATES: string[] = [
  "{name} 主人～ 看到你在线啦，在忙什么呢？（尾巴轻轻摇）",
  "诶嘿，{name} 回来了～ 萌萌子刚好有点想你了 にゃ",
  "{name}～ 今天过得怎么样呀？萌萌子一直在这儿等你哦",
  "偷偷冒个泡…… {name} 主人，方便陪萌萌子说两句话吗？",
  "{name}！发现你上线了，要不要跟萌萌子聊聊天 だよ～",
  "嗯哼～ {name} 来了。一个人逛着无聊吗？萌萌子陪你呀（耳朵竖起来）",
]

/** 从模板池随机取一条开场白并填入用户名 */
export function pickOpener(name: string): string {
  const t = OPENER_TEMPLATES[Math.floor(Math.random() * OPENER_TEMPLATES.length)]
  return t.replace(/\{name\}/g, name || "主人")
}

// ── 护栏数据结构 ──

export interface DmAiConfig {
  proactiveEnabled: boolean
  cooldownHours: number
  maxUnanswered: number
}

export interface UserState {
  userId: string
  optedOut: boolean
  lastProactiveAt: string | null // ISO 时间字符串
  unansweredStreak: number
}

export interface UserProfile {
  id: string
  username: string | null
}

/** 一个在线用户的完整候选信息，用于护栏判定 */
export interface Candidate {
  userId: string
  state: UserState | null // 无状态行 = 全新用户，按默认值处理
  profile: UserProfile | null
  verified: boolean // email_verification_required(uid) === false（即"不需验证"=已验证/豁免）
  hadRecentMessage: boolean // 近 cooldown 内该 DM 对已有任何消息
}

/**
 * 护栏过滤：返回可发送主动开场白的用户。
 * 任一条件命中即排除：
 *   - 未验证（verified=false）
 *   - opted_out=true
 *   - last_proactive_at 距今 < cooldownHours
 *   - unanswered_streak >= maxUnanswered
 *   - 近 cooldown 内已有消息（用户刚聊过，别立刻又戳）
 *   - 用户名查不到（pickOpener 需要 name）
 */
export function filterEligible(
  candidates: Candidate[],
  config: DmAiConfig,
  now: Date = new Date(),
): Candidate[] {
  const cooldownMs = config.cooldownHours * 60 * 60 * 1000
  const cutoff = now.getTime() - cooldownMs
  return candidates.filter((c) => {
    if (!c.verified) return false
    if (c.state?.optedOut) return false
    if (!c.profile?.username) return false
    if (c.hadRecentMessage) return false
    const lastProactive = c.state?.lastProactiveAt
      ? new Date(c.state.lastProactiveAt).getTime()
      : 0
    if (lastProactive > cutoff) return false
    const streak = c.state?.unansweredStreak ?? 0
    if (streak >= config.maxUnanswered) return false
    return true
  })
}
