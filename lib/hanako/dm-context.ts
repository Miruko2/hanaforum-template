/**
 * 萌萌子私信上下文组装 + 自动摘要压缩（共享逻辑）。
 *
 * 供回复路由（/api/hanako-dm）和空闲压缩路由（/api/dm-compress）复用：
 *   - 回复路由：调本函数拿 messages 直接发模型；compressIfOver=HARD（仅积压到兜底
 *     阈值才同步压一次，正常回复不压、不卡顿）
 *   - 压缩路由：空闲时调本函数，compressIfOver=TRIGGER（正常触发点），不生成回复
 *
 * 机制：最近若干条消息原样进上下文（短期记忆）；更老的折叠进摘要（长期记忆）。
 * 压缩一律「从真正最老的一条连续往后」折叠，summarized_up_to 连续推进，
 * 绝不跳过中间消息——根除「按 limit 取最新 N 条、把更老的永久跳过」的健忘黑洞。
 */

import { dmSupabaseAdmin, buildDmSystemPrompt, loadDmAiConfig } from "@/lib/hanako/dm-ai"
import {
  MENGMEGZI_USER_ID,
  DM_KEEP_RECENT_MSGS,
  DM_COMPRESS_SOFT_TOKENS,
  DM_CONTEXT_TOKENS,
  DM_FETCH_LIMIT,
  DM_MAX_FOLD_BATCH,
  DM_SUMMARY_MAX_TOKENS,
  emotionLabel,
  normalizeEmotion,
} from "@/lib/hanako/constants"
import { estimateTokens } from "@/lib/hanako/token-estimate"
import { logPlatformUsage } from "@/lib/platform-usage"

const pairKey = (a: string, b: string) => [a, b].sort().join(":")

type HistMsg = { sender_id: string; content: string; kind: string; created_at: string }

/** 把单条消息转成上下文里的可读文本（区分文本/表情包）。
 *  表情包显示「归一后」的规范 id（旧别名如 surprised→excited），与心情标签一致、不误导模型。 */
function toContextText(m: HistMsg): string {
  if (m.kind !== "sticker") return m.content
  return `[发了${normalizeEmotion(m.content)}表情：${emotionLabel(m.content)}]`
}

/** 估算单条消息在上下文里的 token 数（含每条 ~4 的 role/分隔开销） */
function msgTokens(m: HistMsg): number {
  return estimateTokens(toContextText(m)) + 4
}

/** 拉「最老的」未摘要消息（时间正序，从 summarizedUpTo 之后）。
 *  压缩折叠用——始终从真正最老的一条开始，故 summarized_up_to 连续推进、不留黑洞。 */
async function fetchOldestUnsummarized(
  pk: string,
  summarizedUpTo: string | null,
  limit: number,
): Promise<HistMsg[]> {
  let q = dmSupabaseAdmin
    .from("dm_messages")
    .select("sender_id, content, kind, created_at")
    .eq("pair_key", pk)
    .order("created_at", { ascending: true })
    .limit(limit)
  if (summarizedUpTo) q = q.gt("created_at", new Date(summarizedUpTo).toISOString())
  const { data } = await q
  return (data ?? []) as HistMsg[]
}

/** 拉「最新的」未摘要消息，返回时间正序。组装回复上下文窗口用。 */
async function fetchNewestUnsummarized(
  pk: string,
  summarizedUpTo: string | null,
  limit: number,
): Promise<HistMsg[]> {
  let q = dmSupabaseAdmin
    .from("dm_messages")
    .select("sender_id, content, kind, created_at")
    .eq("pair_key", pk)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (summarizedUpTo) q = q.gt("created_at", new Date(summarizedUpTo).toISOString())
  const { data } = await q
  return ((data ?? []) as HistMsg[]).reverse()
}

/** 用主模型把「旧摘要 + 待摘要消息」压缩成更新后的摘要。失败抛错由调用方 catch。 */
async function generateSummary(opts: {
  cfg: { baseUrl: string; apiKey: string; model: string }
  prevSummary: string
  messages: HistMsg[]
  username: string
}): Promise<string> {
  const { cfg, prevSummary, messages, username } = opts
  const transcript = messages
    .map((m) => {
      const text = toContextText(m)
      return m.sender_id === MENGMEGZI_USER_ID ? `萌萌子：${text}` : `${username}：${text}`
    })
    .join("\n")

  const sys = `你是摘要助手。请把以下私聊记录压缩成一份精炼的长期记忆摘要，供未来对话参考。
要求：
- 保留关键事实：双方提到的人名/昵称、偏好、重要约定、未解决的话题、情绪基调。
- 丢弃寒暄、重复、无信息量的内容。
- 用第三人称客观陈述，中文，控制在 800 字以内。
- 如果已有旧摘要，把它与新记录合并更新（去重、补充、修正），输出完整的新摘要，不要输出增量。
只输出摘要正文，不要任何前缀说明或 JSON。`

  const userMsg = prevSummary
    ? `=== 旧摘要 ===\n${prevSummary}\n\n=== 新增对话记录 ===\n${transcript}\n\n请合并输出更新后的完整摘要：`
    : `=== 对话记录 ===\n${transcript}\n\n请输出摘要：`

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
      max_tokens: DM_SUMMARY_MAX_TOKENS,
      temperature: 0.3,
    }),
  })
  if (!res.ok) {
    throw new Error(`摘要模型错误 ${res.status}: ${await res.text()}`)
  }
  const data = await res.json()
  await logPlatformUsage("mimo", "tokens", data?.usage?.total_tokens, { source: "dm-summary" })
  return data.choices?.[0]?.message?.content?.trim() || ""
}

interface CompactResult {
  compressed: boolean
  summary: string
  summarizedUpTo: string | null
}

/**
 * 按需压缩：把最老的未摘要消息折叠进摘要，summarized_up_to 连续推进（gap-free）。
 *
 * 触发：未摘要条数 > triggerMsgs，或 token 超 DM_COMPRESS_SOFT_TOKENS，或积压 ≥ 拉取上限。
 * 折叠后剩余未摘要 ≤ DM_KEEP_RECENT_MSGS 条且 ≤ DM_COMPRESS_SOFT_TOKENS token。
 * 单次最多折叠 DM_MAX_FOLD_BATCH 条，超额留到下一轮——多轮逐步收敛，绝不丢消息。
 */
async function maybeCompact(opts: {
  pk: string
  userId: string
  username: string
  cfg: { baseUrl: string; apiKey: string; model: string }
  prevSummary: string
  summarizedUpTo: string | null
  triggerMsgs: number
}): Promise<CompactResult> {
  const { pk, userId, username, cfg, prevSummary, summarizedUpTo, triggerMsgs } = opts
  const unchanged: CompactResult = { compressed: false, summary: prevSummary, summarizedUpTo }

  // 从真正最老的一条开始拉（gap-free 的关键）；limit 防极端积压撑爆
  const oldest = await fetchOldestUnsummarized(pk, summarizedUpTo, DM_FETCH_LIMIT)
  if (oldest.length === 0) return unchanged

  const reachedLimit = oldest.length >= DM_FETCH_LIMIT
  const totalTokens = oldest.reduce((s, m) => s + msgTokens(m), 0)

  // 触发判定：条数超阈值 / token 超预算 / 取到上限（积压 ≥ limit，必压）
  if (!(oldest.length > triggerMsgs || totalTokens > DM_COMPRESS_SOFT_TOKENS || reachedLimit)) {
    return unchanged
  }

  // 决定折叠多少条（折最老的，保留最新 KEEP 条且总 token ≤ SOFT）
  let foldN: number
  if (reachedLimit) {
    // 积压可能 > limit：这批只见到最老的 limit 条，最新的没取到。
    // 直接折掉最老的一整批（都是旧消息），余下（含未取到的最新）下轮继续。
    foldN = Math.min(DM_MAX_FOLD_BATCH, oldest.length - 1)
  } else {
    // oldest 即全部未摘要：从尾部（最新）往前数，凑够 KEEP 条 / SOFT token 即停，其余折叠。
    let keep = 0
    let keepTokens = 0
    for (let i = oldest.length - 1; i >= 0; i--) {
      const t = msgTokens(oldest[i])
      if (keep >= DM_KEEP_RECENT_MSGS || keepTokens + t > DM_COMPRESS_SOFT_TOKENS) break
      keep++
      keepTokens += t
    }
    keep = Math.max(1, keep) // 至少保留 1 条
    foldN = Math.min(oldest.length - keep, DM_MAX_FOLD_BATCH)
  }
  if (foldN <= 0) return unchanged

  const toFold = oldest.slice(0, foldN)
  try {
    const newSummary = await generateSummary({ cfg, prevSummary, messages: toFold, username })
    if (!newSummary) return unchanged
    const newUpTo = toFold[toFold.length - 1].created_at
    await dmSupabaseAdmin.from("dm_conv_summary").upsert({
      user_id: userId,
      summary: newSummary,
      summarized_up_to: newUpTo,
      updated_at: new Date().toISOString(),
    })
    return { compressed: true, summary: newSummary, summarizedUpTo: newUpTo }
  } catch (e) {
    console.error("[HanakoDM] 摘要生成失败，沿用旧摘要:", e)
    return unchanged
  }
}

export interface DmContextResult {
  /** 组装好的 messages（system + history），可直接发给 chat-completions */
  messages: { role: "system" | "user" | "assistant"; content: string }[]
  /** 生效的摘要（含本次新压缩的，若有） */
  summary: string
  /** 本次是否实际执行了压缩 */
  compressed: boolean
}

/**
 * 组装私信上下文。
 *
 * @param latestText          最新这条消息的上下文文本（已转换），用于兜底补轮
 * @param latest              最新消息原文（与 history 末尾比对，判断是否需补轮）
 * @param opts.compressIfOver 未摘要条数超过此值（或 token 超预算）则先压缩再组装；
 *   传 undefined 只组装不压缩。回复路由传 DM_COMPRESS_HARD_MSGS（兜底），
 *   空闲压缩路由传 DM_COMPRESS_TRIGGER_MSGS（正常触发点）。
 */
export async function buildDmContext(
  userId: string,
  username: string,
  latestText: string,
  latest: string,
  opts: { compressIfOver?: number },
): Promise<DmContextResult> {
  const cfg = await loadDmAiConfig()
  const pk = pairKey(userId, MENGMEGZI_USER_ID)

  // 1. 拉往期摘要 + 已摘要到的时间点
  const { data: summRow } = await dmSupabaseAdmin
    .from("dm_conv_summary")
    .select("summary, summarized_up_to")
    .eq("user_id", userId)
    .maybeSingle()
  let summary = (summRow as { summary?: string } | null)?.summary?.trim() || ""
  let summarizedUpTo = (summRow as { summarized_up_to?: string } | null)?.summarized_up_to || null

  // 2. 需要时先压缩（折叠最老的进摘要），使下面组装的上下文已反映压缩后状态
  let compressed = false
  if (opts.compressIfOver != null) {
    const r = await maybeCompact({
      pk,
      userId,
      username,
      cfg,
      prevSummary: summary,
      summarizedUpTo,
      triggerMsgs: opts.compressIfOver,
    })
    if (r.compressed) {
      summary = r.summary
      summarizedUpTo = r.summarizedUpTo
      compressed = true
    }
  }

  // 3. 组装上下文窗口：拉最新的未摘要历史（时间正序），再按 token 硬上限从最新往前裁剪
  //    （极端长消息的最后保险，正常不裁——压缩已保证条数/规模有界）。
  const ordered = await fetchNewestUnsummarized(pk, summarizedUpTo, DM_FETCH_LIMIT)

  const windowMsgs: HistMsg[] = []
  let usedTokens = 0
  for (let i = ordered.length - 1; i >= 0; i--) {
    const m = ordered[i]
    const t = msgTokens(m)
    if (usedTokens + t > DM_CONTEXT_TOKENS && windowMsgs.length > 0) break
    usedTokens += t
    windowMsgs.unshift(m)
  }

  const history = windowMsgs.map((m) => ({
    role: (m.sender_id === MENGMEGZI_USER_ID ? "assistant" : "user") as "assistant" | "user",
    content:
      m.sender_id === MENGMEGZI_USER_ID ? toContextText(m) : `${username}：${toContextText(m)}`,
  }))

  // 兜底补轮：最新这条若不在 history 末尾则补一条（回复路由用；预压缩 latest 传空时跳过）
  const lastUserText = [...history].reverse().find((h) => h.role === "user")?.content ?? ""
  if (latest && lastUserText !== `${username}：${latestText}`) {
    history.push({ role: "user", content: `${username}：${latestText}` })
  }

  const messages = [
    { role: "system" as const, content: buildDmSystemPrompt(cfg.persona, summary) },
    ...history,
  ]

  return { messages, summary, compressed }
}

/**
 * 仅执行压缩（不组装回复上下文），供空闲压缩路由 /api/dm-compress 用。
 * 比 buildDmContext 省一次「窗口」查询——空闲预压缩只关心「是否压了」。
 * 内部 maybeCompact 会先判定是否真需要压缩（条数/token 未超阈值则零成本返回，不调模型）。
 */
export async function compactDmContext(
  userId: string,
  username: string,
  triggerMsgs: number,
): Promise<{ compressed: boolean }> {
  const cfg = await loadDmAiConfig()
  const pk = pairKey(userId, MENGMEGZI_USER_ID)

  const { data: summRow } = await dmSupabaseAdmin
    .from("dm_conv_summary")
    .select("summary, summarized_up_to")
    .eq("user_id", userId)
    .maybeSingle()
  const prevSummary = (summRow as { summary?: string } | null)?.summary?.trim() || ""
  const summarizedUpTo =
    (summRow as { summarized_up_to?: string } | null)?.summarized_up_to || null

  const r = await maybeCompact({
    pk,
    userId,
    username,
    cfg,
    prevSummary,
    summarizedUpTo,
    triggerMsgs,
  })
  return { compressed: r.compressed }
}
