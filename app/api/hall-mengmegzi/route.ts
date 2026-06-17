import { NextRequest, NextResponse } from "next/server"
import { loadDmAiConfig, dmSupabaseAdmin, MAX_DM_REPLIES, buildDmSystemPrompt } from "@/lib/hanako/dm-ai"
import {
  MENGMEGZI_USER_ID,
  HANAKO_DM_USERNAME,
  HANAKO_AVATAR,
  MAX_REPLY_TOKENS,
  HALL_CHIME_IN_COOLDOWN_MS,
  HALL_CHIME_IN_CONTEXT_MSGS,
  emotionLabel,
  normalizeEmotion,
} from "@/lib/hanako/constants"
import { splitRepliesIntoRows } from "@/lib/stickers"

// 强制动态渲染
export const dynamic = "force-dynamic"

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 多条回复之间的间隔，让大厅 realtime 先后收到、呈现「连续发来」的节奏感。 */
const REPLY_GAP_MS = 700

/** 解析模型返回的 {replies}，容忍 markdown 包裹与噪声（与私信路由同源逻辑，精简版）。 */
function parseReplies(raw: string): string[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim()
  const tryArr = (s: string): string[] | null => {
    try {
      const o = JSON.parse(s)
      if (Array.isArray(o.replies)) {
        return o.replies
          .map((x: unknown) => (typeof x === "string" ? x.trim() : ""))
          .filter((x: string) => x.length > 0)
          .slice(0, MAX_DM_REPLIES)
      }
      if (typeof o.reply === "string" && o.reply.trim()) return [o.reply.trim()]
      return []
    } catch {
      return null
    }
  }
  const parsed =
    tryArr(cleaned) ??
    (() => {
      const m = cleaned.match(/\{[\s\S]*"repl(?:y|ies)"[\s\S]*\}/)
      return m ? tryArr(m[0]) : null
    })()
  if (parsed && parsed.length > 0) return parsed
  // 非 JSON 纯文本兜底（不含 "repl" 关键字才当作单条）
  return cleaned && !cleaned.includes('"repl') ? [cleaned.slice(0, 480)] : []
}

export async function POST(req: NextRequest) {
  try {
    // 1. 鉴权：需登录用户（任何在线用户都可能掷骰命中触发，但必须是站内已登录用户，
    //    防外部直接调用刷 token）。不限制白名单——大厅是公开场合。
    const authHeader = req.headers.get("authorization") || ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
    if (!token) {
      return NextResponse.json({ error: "未登录", code: "missing_auth" }, { status: 401 })
    }
    const { data: authData, error: authError } = await dmSupabaseAdmin.auth.getUser(token)
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "登录已过期", code: "invalid_auth" }, { status: 401 })
    }

    // 2. 配置：未启用 / 没 key → 静默跳过
    const cfg = await loadDmAiConfig()
    if (!cfg.enabled || !cfg.apiKey) {
      return NextResponse.json({ skipped: true, reason: "disabled" })
    }

    // 3. 服务端冷却：查萌萌子在大厅的上一条发言时间，不足冷却则不发。
    //    多客户端并发掷骰的最终防线——N 个在线用户同时命中 40%，只有距上次发言满
    //    HALL_CHIME_IN_COOLDOWN_MS 的那个请求放行，其余静默跳过。
    const { data: lastMine } = await dmSupabaseAdmin
      .from("chat_messages")
      .select("created_at")
      .eq("user_id", MENGMEGZI_USER_ID)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastMine) {
      const elapsed = Date.now() - new Date(lastMine.created_at).getTime()
      if (elapsed < HALL_CHIME_IN_COOLDOWN_MS) {
        return NextResponse.json({ skipped: true, reason: "cooldown" })
      }
    }

    // 4. 拉大厅最近 N 条消息作上下文（时间正序）。
    //    萌萌子自己的历史发言也混在里面，模型据此知道刚聊到哪、自己说过啥。
    const { data: recentRows, error: histError } = await dmSupabaseAdmin
      .from("chat_messages")
      .select("user_id,username,content,kind,created_at")
      .order("created_at", { ascending: false })
      .limit(HALL_CHIME_IN_CONTEXT_MSGS)
    if (histError) {
      console.error("[HallMengmegzi] 拉历史失败:", histError)
      return NextResponse.json({ error: "服务器错误" }, { status: 500 })
    }
    const recent = ((recentRows ?? []) as {
      user_id: string
      username: string
      content: string
      kind: string
      created_at: string
    }[]).slice().reverse()

    // 5. 组装上下文：把大厅记录转成可读文本喂模型。
    //    表情包消息转成「[发了XX表情：心情]」，与私信一致。
    //    人格直接复用私信的 buildDmSystemPrompt（萌萌子人格统一，私聊/大厅无差别）。
    const transcript = recent
      .map((m) => {
        const text =
          m.kind === "sticker"
            ? `[发了${normalizeEmotion(m.content)}表情：${emotionLabel(m.content)}]`
            : m.content
        const who = m.user_id === MENGMEGZI_USER_ID ? "萌萌子" : m.username || "某人"
        return `${who}：${text}`
      })
      .join("\n")

    const messages = [
      { role: "system" as const, content: buildDmSystemPrompt(cfg.persona) },
      { role: "user" as const, content: `这是公共聊天大厅的最近对话：\n${transcript}\n\n请自然地插一句（可带表情包）。只输出规定 JSON。` },
    ]

    // 6. 调模型
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
        temperature: 0.9,
      }),
    })
    if (!aiResponse.ok) {
      const errText = await aiResponse.text()
      console.error("[HallMengmegzi] 模型错误:", aiResponse.status, errText)
      return NextResponse.json({ error: "AI 服务暂时不可用" }, { status: 502 })
    }
    const aiData = await aiResponse.json()
    const rawReply = aiData.choices?.[0]?.message?.content?.trim() || ""
    const replies = parseReplies(rawReply)
    if (replies.length === 0) {
      console.warn("[HallMengmegzi] 解析回复失败:", rawReply.slice(0, 80))
      return NextResponse.json({ error: "AI 未生成有效回复" }, { status: 500 })
    }

    // 7. 逐条写入 chat_messages（service role 绕 RLS）。
    //    复用私信的 splitRepliesIntoRows：混合表情+文字拆条、未知 [s:xxx] 当文本。
    //    username/avatar_url 写萌萌子的固定值，前端 mapHall 也会按 user_id 强制覆盖。
    const baseTs = Date.now()
    let written = 0
    for (const reply of replies) {
      for (const row of splitRepliesIntoRows(reply)) {
        const content = row.kind === "sticker" ? row.content : row.content.slice(0, 500)
        if (!content) continue
        if (written > 0) await sleep(REPLY_GAP_MS)
        const createdAt = new Date(baseTs + written).toISOString()
        const { error: insertError } = await dmSupabaseAdmin.from("chat_messages").insert([
          {
            user_id: MENGMEGZI_USER_ID,
            username: HANAKO_DM_USERNAME,
            avatar_url: HANAKO_AVATAR,
            kind: row.kind,
            content,
            created_at: createdAt,
          },
        ])
        if (insertError) {
          console.error("[HallMengmegzi] 写入失败:", insertError)
        } else {
          written += 1
        }
      }
    }
    if (written === 0) {
      return NextResponse.json({ error: "写入失败" }, { status: 500 })
    }

    return NextResponse.json({ ok: true, written })
  } catch (error: any) {
    console.error("[HallMengmegzi] 未知错误:", error)
    return NextResponse.json({ error: error?.message || "服务器内部错误" }, { status: 500 })
  }
}
