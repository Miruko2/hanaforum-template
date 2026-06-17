/**
 * 萌萌子私信上下文组装 + 自动摘要压缩（共享逻辑）。
 *
 * 供回复路由（/api/hanako-dm）和压缩路由（/api/dm-compress）复用：
 *   - 回复路由：调本函数拿到 messages 直接发给模型；compress=true 时顺带压缩
 *     （因客户端空闲预压缩，待摘要区通常已空，极少实际触发，避免回复卡顿）
 *   - 压缩路由：仅调本函数执行压缩（compress=true），不生成回复
 *
 * 流程：拉往期摘要 → 拉未摘要历史 → token 滑窗(软上限) → 待摘要区非空则压缩写回 → 组装 messages
 */

import { dmSupabaseAdmin, buildDmSystemPrompt, loadDmAiConfig } from "@/lib/hanako/dm-ai"
import {
  MENGMEGZI_USER_ID,
  DM_CONTEXT_TOKENS,
  DM_SUMMARY_SOFT_TOKENS,
  DM_SUMMARY_MAX_TOKENS,
  emotionLabel,
} from "@/lib/hanako/constants"
import { estimateTokens } from "@/lib/hanako/token-estimate"

const pairKey = (a: string, b: string) => [a, b].sort().join(":")

type HistMsg = { sender_id: string; content: string; kind: string; created_at: string }

/** 把单条消息转成上下文里的可读文本（区分文本/表情包） */
function toContextText(m: HistMsg): string {
  return m.kind === "sticker" ? `[发了${m.content}表情：${emotionLabel(m.content)}]` : m.content
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
  return data.choices?.[0]?.message?.content?.trim() || ""
}

export interface DmContextResult {
  /** 组装好的 messages（system + history），可直接发给 chat-completions */
  messages: { role: "system" | "user" | "assistant"; content: string }[]
  /** 生效的摘要（含本次新压缩的，若有） */
  summary: string
  /** 本次是否实际执行了压缩（待摘要区非空且成功） */
  compressed: boolean
}

/**
 * 组装私信上下文。compress=true 时若待摘要区非空则压缩写回。
 *
 * @param latestText     最新这条消息的上下文文本（已转换），用于兜底补轮
 * @param latest         最新消息原文（用于和 history 末尾比对，判断是否需补轮）
 * @param opts.compress  是否允许压缩写回（回复路由和压缩路由都传 true）
 */
export async function buildDmContext(
  userId: string,
  username: string,
  latestText: string,
  latest: string,
  opts: { compress: boolean },
): Promise<DmContextResult> {
  const cfg = await loadDmAiConfig()
  const pk = pairKey(userId, MENGMEGZI_USER_ID)

  // 拉往期摘要
  const { data: summRow } = await dmSupabaseAdmin
    .from("dm_conv_summary")
    .select("summary, summarized_up_to")
    .eq("user_id", userId)
    .maybeSingle()
  const summary = (summRow as { summary?: string } | null)?.summary?.trim() || ""
  const summarizedUpTo = (summRow as { summarized_up_to?: string } | null)?.summarized_up_to
    ? new Date((summRow as { summarized_up_to: string }).summarized_up_to)
    : null

  // 拉未摘要历史
  let histQuery = dmSupabaseAdmin
    .from("dm_messages")
    .select("sender_id, content, kind, created_at")
    .eq("pair_key", pk)
    .order("created_at", { ascending: false })
    .limit(200)
  if (summarizedUpTo) {
    histQuery = histQuery.gt("created_at", summarizedUpTo.toISOString())
  }
  const { data: hist } = await histQuery
  const ordered = ((hist ?? []) as HistMsg[]).reverse()

  // token 滑动窗口（硬上限 DM_CONTEXT_TOKENS）：窗口内的保留，超出的成待摘要区
  const windowMsgs: HistMsg[] = []
  let usedTokens = 0
  for (let i = ordered.length - 1; i >= 0; i--) {
    const m = ordered[i]
    const t = estimateTokens(toContextText(m)) + 4
    if (usedTokens + t > DM_CONTEXT_TOKENS && windowMsgs.length > 0) {
      break
    }
    usedTokens += t
    windowMsgs.unshift(m)
  }
  const toSummarize = ordered.slice(0, ordered.length - windowMsgs.length)

  const history = windowMsgs.map((m) => ({
    role: (m.sender_id === MENGMEGZI_USER_ID ? "assistant" : "user") as "assistant" | "user",
    content:
      m.sender_id === MENGMEGZI_USER_ID ? toContextText(m) : `${username}：${toContextText(m)}`,
  }))

  // 兜底补轮：最新消息若不在 history 末尾则补一条
  const lastUserText = [...history].reverse().find((h) => h.role === "user")?.content ?? ""
  if (latest && lastUserText !== `${username}：${latestText}`) {
    history.push({ role: "user", content: `${username}：${latestText}` })
  }

  // 压缩：待摘要区非空 → 生成新摘要写回。失败沿用旧摘要。
  let effectiveSummary = summary
  let compressed = false
  if (opts.compress && toSummarize.length > 0) {
    try {
      const newSummary = await generateSummary({ cfg, prevSummary: summary, messages: toSummarize, username })
      if (newSummary) {
        const lastSummarizedAt = toSummarize[toSummarize.length - 1].created_at
        await dmSupabaseAdmin
          .from("dm_conv_summary")
          .upsert({
            user_id: userId,
            summary: newSummary,
            summarized_up_to: lastSummarizedAt,
            updated_at: new Date().toISOString(),
          })
        effectiveSummary = newSummary
        compressed = true
      }
    } catch (e) {
      console.error("[HanakoDM] 摘要生成失败，沿用旧摘要:", e)
    }
  }

  const messages = [
    { role: "system" as const, content: buildDmSystemPrompt(cfg.persona, effectiveSummary) },
    ...history,
  ]

  return { messages, summary: effectiveSummary, compressed }
}

/** 软上限检查：未摘要历史是否超过软阈值（客户端空闲预压缩用）。
 *  返回 true 表示该压缩了。 */
export async function shouldCompress(userId: string): Promise<boolean> {
  const pk = pairKey(userId, MENGMEGZI_USER_ID)
  const { data: summRow } = await dmSupabaseAdmin
    .from("dm_conv_summary")
    .select("summarized_up_to")
    .eq("user_id", userId)
    .maybeSingle()
  const summarizedUpTo = (summRow as { summarized_up_to?: string } | null)?.summarized_up_to
    ? new Date((summRow as { summarized_up_to: string }).summarized_up_to)
    : null

  let histQuery = dmSupabaseAdmin
    .from("dm_messages")
    .select("sender_id, content, kind, created_at")
    .eq("pair_key", pk)
    .order("created_at", { ascending: false })
    .limit(200)
  if (summarizedUpTo) {
    histQuery = histQuery.gt("created_at", summarizedUpTo.toISOString())
  }
  const { data: hist } = await histQuery
  const ordered = ((hist ?? []) as HistMsg[]).reverse()

  let totalTokens = 0
  for (const m of ordered) {
    totalTokens += estimateTokens(toContextText(m)) + 4
  }
  return totalTokens > DM_SUMMARY_SOFT_TOKENS
}
