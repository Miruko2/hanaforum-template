import { NextRequest, NextResponse } from "next/server"
import dmRateLimiter from "@/lib/hanako/dm-rate-limit"
import { loadDmAiConfig, dmSupabaseAdmin, MAX_DM_REPLIES } from "@/lib/hanako/dm-ai"
import { MENGMEGZI_USER_ID, MAX_REPLY_TOKENS, emotionLabel } from "@/lib/hanako/constants"
import { buildDmContext } from "@/lib/hanako/dm-context"

// 强制动态渲染
export const dynamic = "force-dynamic"

const pairKey = (a: string, b: string) => [a, b].sort().join(":")

/** 多条回复之间的间隔：让客户端经 realtime 先后收到，呈现「连续发来」的节奏感。
 *  不宜太长（拖慢响应）、不宜太短（多条挤在一起像一条）。 */
const REPLY_GAP_MS = 700

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

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

    const body = (await req.json().catch(() => ({}))) as { content?: string; kind?: string }
    const latestKind = body.kind === "sticker" ? "sticker" : "text"
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

    // 5. 上下文组装：摘要（长期记忆）+ token 滑动窗口（近期对话）。
    //    逻辑抽到 lib/hanako/dm-context.ts 的 buildDmContext，与压缩路由共享。
    //    compress=true：待摘要区非空则顺带压缩写回。因客户端空闲预压缩（软上限 28K），
    //    待摘要区通常已被提前清空，这里极少实际触发，避免回复卡顿。
    const username =
      (authUser.user_metadata?.username as string | undefined) ||
      (authUser.email ? authUser.email.split("@")[0] : null) ||
      "主人"
    const latestText =
      latestKind === "sticker" ? `[发了${latest}表情：${emotionLabel(latest)}]` : latest
    const { messages } = await buildDmContext(userId, username, latestText, latest, { compress: true })
    const pk = pairKey(userId, MENGMEGZI_USER_ID)

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
