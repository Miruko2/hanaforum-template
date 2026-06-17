import { NextRequest, NextResponse } from "next/server"
import rateLimiter from "@/lib/hanako/rate-limit"
import { loadDmAiConfig, buildDmSystemPrompt, dmSupabaseAdmin } from "@/lib/hanako/dm-ai"
import { HANAKO_USER_ID, MAX_REPLY_TOKENS } from "@/lib/hanako/constants"

// 强制动态渲染
export const dynamic = "force-dynamic"

const pairKey = (a: string, b: string) => [a, b].sort().join(":")

/** 解析模型返回的 {reply, optOut}，容忍 markdown 代码块包裹与少量噪声 */
function parseReply(raw: string): { reply: string; optOut: boolean } {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim()
  const tryParse = (s: string) => {
    const o = JSON.parse(s)
    return {
      reply: typeof o.reply === "string" ? o.reply : "",
      optOut: o.optOut === true,
    }
  }
  try {
    return tryParse(cleaned)
  } catch {
    const m = cleaned.match(/\{[\s\S]*"reply"[\s\S]*\}/)
    if (m) {
      try {
        return tryParse(m[0])
      } catch {}
    }
    // 不是 JSON 的纯文本：当作 reply 本身兜底
    return { reply: cleaned.includes('"reply"') ? "" : cleaned.slice(0, 480), optOut: false }
  }
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

    // hanako 不给自己回
    if (userId === HANAKO_USER_ID) {
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

    // 4. 并发限流（复用弹幕墙那套，防同一用户狂发刷 LLM 调用）
    const rc = rateLimiter.checkRateLimit(userId)
    if (!rc.allowed) {
      return NextResponse.json({ error: rc.reason, code: "rate_limited" }, { status: 429 })
    }
    rateLimiter.startCall(userId)

    // 5. 拉这对会话最近历史，转成对话上下文（hanako=assistant，用户=user）
    const pk = pairKey(userId, HANAKO_USER_ID)
    const { data: hist } = await dmSupabaseAdmin
      .from("dm_messages")
      .select("sender_id, content, kind, created_at")
      .eq("pair_key", pk)
      .order("created_at", { ascending: false })
      .limit(20)
    const ordered = ((hist ?? []) as { sender_id: string; content: string; kind: string }[])
      .reverse()
      .filter((m) => m.kind === "text")

    const username =
      (authUser.user_metadata?.username as string | undefined) ||
      (authUser.email ? authUser.email.split("@")[0] : null) ||
      "主人"

    const history = ordered.map((m) => ({
      role: m.sender_id === HANAKO_USER_ID ? ("assistant" as const) : ("user" as const),
      content: m.sender_id === HANAKO_USER_ID ? m.content : `${username}：${m.content}`,
    }))

    // 客户端"先插入再触发本路由"，正常情况下 latest 已在 history 末尾。
    // 兜底：若因读写时序 latest 不在末尾，补一条 user 轮，保证模型看到最新这句。
    const lastUserText =
      [...history].reverse().find((h) => h.role === "user")?.content ?? ""
    if (latest && lastUserText !== `${username}：${latest}`) {
      history.push({ role: "user", content: `${username}：${latest}` })
    }

    const messages = [{ role: "system" as const, content: buildDmSystemPrompt(cfg.persona) }, ...history]

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
    const { reply, optOut } = parseReply(rawReply)

    if (!reply) {
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

    // 8. 写回复（service role 绕 RLS）。对方客户端经 dm_incoming / dm_<pair> 订阅实时收到
    const { error: insertError } = await dmSupabaseAdmin.from("dm_messages").insert([
      {
        pair_key: pk,
        sender_id: HANAKO_USER_ID,
        recipient_id: userId,
        kind: "text",
        content: reply.slice(0, 500),
      },
    ])
    if (insertError) {
      console.error("[HanakoDM] 写入失败:", insertError)
      return NextResponse.json({ error: "写入失败" }, { status: 500 })
    }

    return NextResponse.json({ reply, optOut })
  } catch (error: any) {
    console.error("[HanakoDM] 未知错误:", error)
    return NextResponse.json({ error: error?.message || "服务器内部错误" }, { status: 500 })
  } finally {
    if (userId) rateLimiter.endCall(userId)
  }
}
