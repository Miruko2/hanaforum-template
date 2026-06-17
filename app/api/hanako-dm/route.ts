import { NextRequest, NextResponse } from "next/server"
import dmRateLimiter from "@/lib/hanako/dm-rate-limit"
import { loadDmAiConfig, buildDmSystemPrompt, dmSupabaseAdmin, MAX_DM_REPLIES } from "@/lib/hanako/dm-ai"
import { MENGMEGZI_USER_ID, MAX_REPLY_TOKENS, DM_CONTEXT_TOKENS, DM_SUMMARY_MAX_TOKENS } from "@/lib/hanako/constants"
import { estimateTokens } from "@/lib/hanako/token-estimate"

// 强制动态渲染
export const dynamic = "force-dynamic"

const pairKey = (a: string, b: string) => [a, b].sort().join(":")

/** 多条回复之间的间隔：让客户端经 realtime 先后收到，呈现「连续发来」的节奏感。
 *  不宜太长（拖慢响应）、不宜太短（多条挤在一起像一条）。 */
const REPLY_GAP_MS = 700

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 用主模型把「旧摘要 + 待摘要消息」压缩成更新后的摘要，作为长期记忆。
 *  返回新摘要文本；失败抛错由调用方 catch。 */
async function generateSummary(opts: {
  cfg: { baseUrl: string; apiKey: string; model: string }
  prevSummary: string
  messages: { sender_id: string; content: string }[]
  username: string
}): Promise<string> {
  const { cfg, prevSummary, messages, username } = opts
  // 把待摘要区消息拼成可读对话文本
  const transcript = messages
    .map((m) =>
      m.sender_id === MENGMEGZI_USER_ID
        ? `萌萌子：${m.content}`
        : `${username}：${m.content}`,
    )
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
  const out = data.choices?.[0]?.message?.content?.trim() || ""
  return out
}

/** 解析模型返回的 {replies, optOut}，容忍 markdown 代码块包裹与少量噪声。
 *  replies 为 1～N 条短消息数组；兼容旧的 {reply} 字段与纯文本兜底。 */
function parseReplies(raw: string): { replies: string[]; optOut: boolean } {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim()
  const tryParse = (s: string): { replies: string[]; optOut: boolean } => {
    const o = JSON.parse(s)
    // 新格式：replies 数组
    if (Array.isArray(o.replies)) {
      const rs = o.replies
        .map((x: unknown) => (typeof x === "string" ? x.trim() : ""))
        .filter((x: string) => x.length > 0)
        .slice(0, MAX_DM_REPLIES)
      return { replies: rs, optOut: o.optOut === true }
    }
    // 兼容旧格式 / 模型偶尔输出单 reply 字段
    if (typeof o.reply === "string" && o.reply.trim()) {
      return { replies: [o.reply.trim()], optOut: o.optOut === true }
    }
    return { replies: [], optOut: o.optOut === true }
  }
  const parsed = (() => {
    try {
      return tryParse(cleaned)
    } catch {
      const m = cleaned.match(/\{[\s\S]*"repl(?:y|ies)"[\s\S]*\}/)
      if (m) {
        try {
          return tryParse(m[0])
        } catch {}
      }
      return null
    }
  })()
  if (parsed && parsed.replies.length > 0) return parsed
  // 不是 JSON 的纯文本：当作单条 reply 兜底
  if (parsed && parsed.replies.length === 0) {
    return { replies: [], optOut: parsed.optOut }
  }
  return { replies: cleaned && !cleaned.includes('"repl') ? [cleaned.slice(0, 480)] : [], optOut: false }
}

export async function POST(req: NextRequest) {
  let userId = ""
  try {
    // 1. 身份校验（唯一可信 user 来源）
    const authHeader = req.headers.get("authorization") || ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
    if (!token) {
      return NextResponse.json({ error: "未登录", code: "missing_auth" }, { status: 401 })
    }
    const { data: authData, error: authError } = await dmSupabaseAdmin.auth.getUser(token)
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "登录已过期", code: "invalid_auth" }, { status: 401 })
    }
    const authUser = authData.user
    userId = authUser.id

    // 萌萌子不给自己回
    if (userId === MENGMEGZI_USER_ID) {
      return NextResponse.json({ skipped: true })
    }

    const body = (await req.json().catch(() => ({}))) as { content?: string }
    const latest = typeof body.content === "string" ? body.content.trim().slice(0, 500) : ""

    // 2. 配置：未启用 / 没 key → 静默跳过（客户端忽略，行为=她不回）
    const cfg = await loadDmAiConfig()
    if (!cfg.enabled || !cfg.apiKey) {
      return NextResponse.json({ skipped: true, reason: "disabled" })
    }

    // 3. 被封用户不回（与全站封禁一致）
    const { data: banned } = await dmSupabaseAdmin
      .from("banned_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle()
    if (banned) {
      return NextResponse.json({ skipped: true, reason: "banned" })
    }

    // 4. 并发限流（私信专用 dmRateLimiter，独立于弹幕墙，互不挤占）
    const rc = dmRateLimiter.checkRateLimit(userId)
    if (!rc.allowed) {
      return NextResponse.json({ error: rc.reason, code: "rate_limited" }, { status: 429 })
    }
    dmRateLimiter.startCall(userId)

    // 5. 上下文组装：摘要（长期记忆）+ token 滑动窗口（近期对话）
    const pk = pairKey(userId, MENGMEGZI_USER_ID)
    const username =
      (authUser.user_metadata?.username as string | undefined) ||
      (authUser.email ? authUser.email.split("@")[0] : null) ||
      "主人"

    // 5a. 拉往期摘要（超出窗口的旧消息已压缩成的长期记忆）
    const { data: summRow } = await dmSupabaseAdmin
      .from("dm_conv_summary")
      .select("summary, summarized_up_to")
      .eq("user_id", userId)
      .maybeSingle()
    const summary = (summRow as { summary?: string } | null)?.summary?.trim() || ""
    const summarizedUpTo = (summRow as { summarized_up_to?: string } | null)?.summarized_up_to
      ? new Date((summRow as { summarized_up_to: string }).summarized_up_to)
      : null

    // 5b. 拉未摘要历史（摘要覆盖点之后的所有文本消息，靠 token 裁剪而非条数）
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
    // 倒序取回 → reverse 成正序（旧→新）；只取文本消息
    const ordered = ((hist ?? []) as { sender_id: string; content: string; kind: string; created_at: string }[])
      .reverse()
      .filter((m) => m.kind === "text")

    // 5c. token 滑动窗口：从最新消息往前累加，窗口内的保留为 history，超出的成「待摘要区」
    const windowMsgs: typeof ordered = []
    let usedTokens = 0
    for (let i = ordered.length - 1; i >= 0; i--) {
      const m = ordered[i]
      const t = estimateTokens(m.content) + 4 // +4 为 role 包装开销
      if (usedTokens + t > DM_CONTEXT_TOKENS && windowMsgs.length > 0) {
        break // 加这条会超窗口，停止；剩余（更早的）进待摘要区
      }
      usedTokens += t
      windowMsgs.unshift(m) // unshift 保持正序
    }
    // 待摘要区 = ordered 里没进窗口的较早部分（已在上面 break 时确定）
    const toSummarize = ordered.slice(0, ordered.length - windowMsgs.length)

    const history = windowMsgs.map((m) => ({
      role: m.sender_id === MENGMEGZI_USER_ID ? ("assistant" as const) : ("user" as const),
      content: m.sender_id === MENGMEGZI_USER_ID ? m.content : `${username}：${m.content}`,
    }))

    // 客户端"先插入再触发本路由"，正常情况下 latest 已在 history 末尾。
    // 兜底：若因读写时序 latest 不在末尾，补一条 user 轮，保证模型看到最新这句。
    const lastUserText = [...history].reverse().find((h) => h.role === "user")?.content ?? ""
    if (latest && lastUserText !== `${username}：${latest}`) {
      history.push({ role: "user", content: `${username}：${latest}` })
    }

    // 5d. 自动压缩：待摘要区非空 → 用主模型把「旧摘要 + 待摘要区」压缩成新摘要，写回 DB。
    //     失败不阻断主回复（catch 后用旧 summary 继续，下次再试）。
    let effectiveSummary = summary
    if (toSummarize.length > 0) {
      try {
        const newSummary = await generateSummary({
          cfg,
          prevSummary: summary,
          messages: toSummarize,
          username,
        })
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
        }
      } catch (e) {
        console.error("[HanakoDM] 摘要生成失败，沿用旧摘要:", e)
      }
    }

    const messages = [
      { role: "system" as const, content: buildDmSystemPrompt(cfg.persona, effectiveSummary) },
      ...history,
    ]

    // 6. 调独立私信模型
    const aiResponse = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        max_tokens: MAX_REPLY_TOKENS,
        temperature: 0.85,
      }),
    })
    if (!aiResponse.ok) {
      const errText = await aiResponse.text()
      console.error("[HanakoDM] 模型错误:", aiResponse.status, errText)
      return NextResponse.json({ error: "AI 服务暂时不可用" }, { status: 502 })
    }
    const aiData = await aiResponse.json()
    const rawReply = aiData.choices?.[0]?.message?.content?.trim() || ""
    const { replies, optOut } = parseReplies(rawReply)

    if (replies.length === 0) {
      console.warn("[HanakoDM] 解析回复失败:", rawReply.slice(0, 80))
      return NextResponse.json({ error: "AI 未生成有效回复" }, { status: 500 })
    }

    // 7. 护栏状态：opt-out 或重置未回计数（用户回应了说明在聊）
    if (optOut) {
      await dmSupabaseAdmin
        .from("hanako_dm_state")
        .upsert({ user_id: userId, opted_out: true, updated_at: new Date().toISOString() })
    } else {
      await dmSupabaseAdmin
        .from("hanako_dm_state")
        .upsert({ user_id: userId, unanswered_streak: 0, updated_at: new Date().toISOString() })
    }

    // 8. 逐条写入（service role 绕 RLS）。多条之间间隔 REPLY_GAP_MS 依次插入，
    //    并显式递增 created_at —— 既保证历史查询的时间顺序，也让对方客户端经
    //    dm_incoming / dm_<pair> 实时订阅先后收到，呈现「连续发来多条」的节奏感。
    const baseTs = Date.now()
    let written = 0
    for (let i = 0; i < replies.length; i++) {
      if (i > 0) await sleep(REPLY_GAP_MS)
      // created_at 递增 1ms，确保按时间排序时多条回复顺序稳定（不与同毫秒的其它行碰撞）
      const createdAt = new Date(baseTs + i).toISOString()
      const { error: insertError } = await dmSupabaseAdmin.from("dm_messages").insert([
        {
          pair_key: pk,
          sender_id: MENGMEGZI_USER_ID,
          recipient_id: userId,
          kind: "text",
          content: replies[i].slice(0, 500),
          created_at: createdAt,
        },
      ])
      if (insertError) {
        // 单条失败不中断后续条；全部失败才报错
        console.error("[HanakoDM] 写入失败:", insertError)
      } else {
        written += 1
      }
    }
    if (written === 0) {
      return NextResponse.json({ error: "写入失败" }, { status: 500 })
    }

    // 返回合并后的全文（兼容旧返回结构）；客户端是 fire-and-forget，不读返回值，
    // 回复纯靠 realtime 推送，故这里返回什么不影响前端逐条呈现。
    return NextResponse.json({ reply: replies.join("\n"), replies, optOut })
  } catch (error: any) {
    console.error("[HanakoDM] 未知错误:", error)
    return NextResponse.json({ error: error?.message || "服务器内部错误" }, { status: 500 })
  } finally {
    if (userId) dmRateLimiter.endCall(userId)
  }
}
