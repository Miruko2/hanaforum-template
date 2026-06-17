// 萌萌子主动私信触发器：cron 每 5 分钟扫描在线用户，按护栏给通过的用户发零 token 模板开场白。
//
// 设计要点（见 docs/superpowers/specs/2026-06-18-mengmegzi-proactive-dm-design.md）：
//   - 开场白走模板不调 LLM，省 token；用户回复后才进真实 AI 对话
//   - 只发"真实活跃用户"（发过帖/评论/弹幕的人）：冷启动破冰只找会用论坛的人，
//     不依赖邮箱验证开关（站方曾因 SMTP 配额爆掉而取消验证，大量老用户未验证）
//   - 护栏：opted_out / cooldown / max_unanswered / 近冷却期已有消息
//   - DB 逻辑在 worker 里用裸 fetch 打 Supabase REST（worker 无 supabase-js 依赖）

import type { Env } from "./index"

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
  active: boolean // 是否发过帖/评论/弹幕（真实活跃用户门槛，取代原"邮箱已验证"判定）
  hadRecentMessage: boolean // 近 cooldown 内该 DM 对已有任何消息
}

/**
 * 护栏过滤：返回可发送主动开场白的用户。
 * 任一条件命中即排除：
 *   - 非活跃（active=false：没发过帖/评论/弹幕）
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
    if (!c.active) return false
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

// ── Supabase REST 辅助（worker 无 supabase-js，用裸 fetch） ──

function supaHeaders(env: Env): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  }
}

function supaUrl(env: Env, path: string): string {
  return `${env.SUPABASE_URL.replace(/\/$/, "")}${path}`
}

async function supaGet<T>(env: Env, path: string): Promise<T | null> {
  const res = await fetch(supaUrl(env, path), { headers: supaHeaders(env) })
  if (!res.ok) {
    console.error(`[proactive] supaGet ${path} failed: ${res.status} ${await res.text()}`)
    return null
  }
  return (await res.json()) as T
}

async function supaPost<T>(env: Env, path: string, body: unknown): Promise<T | null> {
  const res = await fetch(supaUrl(env, path), {
    method: "POST",
    headers: supaHeaders(env),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error(`[proactive] supaPost ${path} failed: ${res.status} ${await res.text()}`)
    return null
  }
  return (await res.json()) as T
}

// pair_key 与 Next.js 侧一致：排序后拼接
function pairKey(a: string, b: string): string {
  return [a, b].sort().join(":")
}

// ── 各阶段查询 ──

async function loadConfig(env: Env): Promise<DmAiConfig | null> {
  const data = await supaGet<Array<{
    proactive_enabled: boolean
    cooldown_hours: number
    max_unanswered: number
  }>>(env, "/rest/v1/dm_ai_config?id=eq.1&select=proactive_enabled,cooldown_hours,max_unanswered")
  if (!data || data.length === 0) return null
  const r = data[0]
  return {
    proactiveEnabled: r.proactive_enabled,
    cooldownHours: r.cooldown_hours,
    maxUnanswered: r.max_unanswered,
  }
}

async function loadStates(env: Env, userIds: string[]): Promise<Map<string, UserState>> {
  if (userIds.length === 0) return new Map()
  const filter = `user_id=in.(${userIds.join(",")})`
  const data = await supaGet<Array<{
    user_id: string
    opted_out: boolean
    last_proactive_at: string | null
    unanswered_streak: number
  }>>(env, `/rest/v1/hanako_dm_state?${filter}&select=user_id,opted_out,last_proactive_at,unanswered_streak`)
  const m = new Map<string, UserState>()
  if (data) for (const r of data) {
    m.set(r.user_id, {
      userId: r.user_id,
      optedOut: r.opted_out,
      lastProactiveAt: r.last_proactive_at,
      unansweredStreak: r.unanswered_streak,
    })
  }
  return m
}

async function loadRecentMessagePairs(
  env: Env,
  mengmegziId: string,
  userIds: string[],
  cutoffIso: string,
): Promise<Set<string>> {
  // 返回近 cutoff 内已有消息的 pair_key 集合
  if (userIds.length === 0) return new Set()
  const pairKeys = userIds.map((u) => pairKey(u, mengmegziId))
  // PostgREST in. 用逗号分隔字面值；pair_key 是 uuid:uuid，仅含 [0-9a-f-:]，
  // 在 URL query 里安全，无需编码（与 loadStates/loadProfiles 的约定一致）
  const inList = pairKeys.join(",")
  const data = await supaGet<Array<{ pair_key: string }>>(
    env,
    `/rest/v1/dm_messages?pair_key=in.(${inList})&created_at=gte.${cutoffIso}&select=pair_key`,
  )
  return new Set(data ? data.map((r) => r.pair_key) : [])
}

/** 批量查"真实活跃用户"：返回 userIds 中、在 posts/comments/live_comments 任一张表
 *  发过内容的 user_id 集合（取代原邮箱验证判定）。三表作者列均为 user_id（已核对
 *  openapi schema + moderate-text）；service_role 绕 RLS 可见全部行，三表并行查、内存求并集。
 *  - 调用前 userIds 已被廉价护栏收窄（见 runProactiveSweep），避免给已排除用户白查内容表、控 egress。
 *  - 失败降级：某张表查询失败（supaGet 返 null）则跳过该表，至多漏判该表独占的活跃者，
 *    本轮不戳、下轮重试——fail-close，绝不误发。 */
async function loadActiveUsers(env: Env, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const inList = userIds.join(",")
  const active = new Set<string>()
  await Promise.all(
    ["posts", "comments", "live_comments"].map(async (table) => {
      const data = await supaGet<Array<{ user_id: string }>>(
        env,
        `/rest/v1/${table}?user_id=in.(${inList})&select=user_id`,
      )
      if (data) for (const r of data) active.add(r.user_id)
    }),
  )
  return active
}

async function loadProfiles(env: Env, userIds: string[]): Promise<Map<string, UserProfile>> {
  if (userIds.length === 0) return new Map()
  const filter = `id=in.(${userIds.join(",")})`
  const data = await supaGet<Array<{ id: string; username: string | null }>>(
    env,
    `/rest/v1/profiles?${filter}&select=id,username`,
  )
  const m = new Map<string, UserProfile>()
  if (data) for (const r of data) m.set(r.id, { id: r.id, username: r.username })
  return m
}

async function sendOpener(env: Env, mengmegziId: string, userId: string, username: string): Promise<boolean> {
  const baseTs = Date.now()
  const text = pickOpener(username)
  const rows = [
    {
      pair_key: pairKey(userId, mengmegziId),
      sender_id: mengmegziId,
      recipient_id: userId,
      kind: "text",
      content: text.slice(0, 500),
      created_at: new Date(baseTs).toISOString(),
    },
    {
      pair_key: pairKey(userId, mengmegziId),
      sender_id: mengmegziId,
      recipient_id: userId,
      kind: "sticker",
      // content 存裸表情 ID（如 "happy"），与 splitRepliesIntoRows 的约定一致：
      // 客户端 floating-chat.tsx 直接用 content 拼贴纸 URL /hanako/stickers/<name>。
      // 切勿存 "[s:happy]"——那是 AI 回复文本里的解析标记，存进 DB 会导致客户端 404 破图。
      content: "happy",
      created_at: new Date(baseTs + 1).toISOString(),
    },
  ]
  const result = await supaPost<unknown>(env, "/rest/v1/dm_messages", rows)
  if (result === null) return false
  console.log(`[proactive] 已发开场白给 ${username} (${userId})`)
  return true
}

async function bumpState(env: Env, userId: string, prevStreak: number): Promise<void> {
  // upsert：last_proactive_at=now, unanswered_streak += 1, 不动 opted_out
  const body = {
    user_id: userId,
    last_proactive_at: new Date().toISOString(),
    unanswered_streak: prevStreak + 1,
    updated_at: new Date().toISOString(),
  }
  // PostgREST upsert：Prefer: resolution=merge-duplicates
  const res = await fetch(supaUrl(env, "/rest/v1/hanako_dm_state"), {
    method: "POST",
    headers: { ...supaHeaders(env), Prefer: "return=minimal, resolution=merge-duplicates" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error(`[proactive] bumpState ${userId} failed: ${res.status} ${await res.text()}`)
  }
}

// ── 主流程 ──

export async function runProactiveSweep(env: Env): Promise<void> {
  // 全局 kill switch 与 presence 共用
  if (env.PRESENCE_ENABLED !== "true") {
    console.log("[proactive] PRESENCE_ENABLED!=true，跳过")
    return
  }

  const config = await loadConfig(env)
  if (!config) {
    console.log("[proactive] 读不到 dm_ai_config，跳过")
    return
  }
  if (!config.proactiveEnabled) {
    console.log("[proactive] proactive_enabled=false，跳过")
    return
  }

  // 拿在线 userId 列表（DO stub fetch /online）
  const mengmegziId = env.MENGMEGZI_USER_ID
  const doId = env.PRESENCE.idFromName("global")
  const doStub = env.PRESENCE.get(doId)
  const onlineRes = await doStub.fetch("https://internal/online")
  if (!onlineRes.ok) {
    console.error(`[proactive] DO /online 失败: ${onlineRes.status}`)
    return
  }
  const online = (await onlineRes.json()) as { users: string[] }
  const onlineIds = online.users.filter((id) => id !== mengmegziId) // 不给自己发
  if (onlineIds.length === 0) {
    console.log("[proactive] 无在线用户")
    return
  }

  const cooldownMs = config.cooldownHours * 60 * 60 * 1000
  const cutoffIso = new Date(Date.now() - cooldownMs).toISOString()

  // 批量查状态 / 近期消息 / profiles
  const [states, recentPairs, profiles] = await Promise.all([
    loadStates(env, onlineIds),
    loadRecentMessagePairs(env, mengmegziId, onlineIds, cutoffIso),
    loadProfiles(env, onlineIds),
  ])

  // 组装候选。active 先乐观置 true：内容表（尤其弹幕）行数大，不能每轮给所有在线用户都查；
  // 先跑一遍廉价护栏（active=true 时此条不拦）筛出"只差活跃度判定"的候选，再只给他们查内容表。
  const candidates: Candidate[] = onlineIds.map((uid) => {
    const pk = pairKey(uid, mengmegziId)
    return {
      userId: uid,
      state: states.get(uid) ?? null,
      profile: profiles.get(uid) ?? null,
      active: true, // 占位，下面用真实活跃度覆盖
      hadRecentMessage: recentPairs.has(pk),
    }
  })

  // 第一遍护栏：筛掉 opt-out / 冷却中 / 近期聊过 / 无用户名的，留下"只差活跃度"的候选
  const maybe = filterEligible(candidates, config)
  // 只为这些幸存者查"发过帖/评论/弹幕"，回填真实 active（control egress：稳态下基本只查新候选）
  const activeSet = await loadActiveUsers(env, maybe.map((c) => c.userId))
  for (const c of maybe) c.active = activeSet.has(c.userId)
  // 第二遍护栏：带真实 active，得权威可发列表
  const eligible = filterEligible(maybe, config)
  console.log(`[proactive] 在线 ${onlineIds.length}，待定 ${maybe.length}，可发 ${eligible.length}`)

  // 逐个发送 + bumpState
  let sent = 0
  for (const c of eligible) {
    const ok = await sendOpener(env, mengmegziId, c.userId, c.profile!.username!)
    if (ok) {
      await bumpState(env, c.userId, c.state?.unansweredStreak ?? 0)
      sent++
    }
  }
  console.log(`[proactive] 本轮已发 ${sent} 条开场白`)
}
