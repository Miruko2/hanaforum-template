import { NextRequest, NextResponse } from "next/server"
import dmRateLimiter from "@/lib/hanako/dm-rate-limit"
import { loadDmAiConfig, dmSupabaseAdmin, MAX_DM_REPLIES } from "@/lib/hanako/dm-ai"
import { MENGMEGZI_USER_ID, MAX_REPLY_TOKENS, emotionLabel, normalizeEmotion, DM_COMPRESS_HARD_MSGS, DM_STICKER_INJECT_PROBABILITY } from "@/lib/hanako/constants"
import { buildDmContext } from "@/lib/hanako/dm-context"
import { isWebSearchEnabled, searchWeb, WEB_SEARCH_TOOL } from "@/lib/hanako/web-search"
import { logPlatformUsage } from "@/lib/platform-usage"
import { splitRepliesIntoRows } from "@/lib/stickers"

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

    // 5. 上下文组装：摘要（长期记忆）+ 最近原文窗口（短期记忆）。
    //    逻辑抽到 lib/hanako/dm-context.ts 的 buildDmContext，与空闲压缩路由共享。
    //    compressIfOver=HARD：仅当未摘要积压到兜底阈值（说明客户端空闲压缩一直没跑）
    //    才在回复前同步压一次；正常由空闲预压缩处理，这里不压、不卡顿。
    const username =
      (authUser.user_metadata?.username as string | undefined) ||
      (authUser.email ? authUser.email.split("@")[0] : null) ||
      "主人"
    const latestText =
      latestKind === "sticker"
        ? `[发了${normalizeEmotion(latest)}表情：${emotionLabel(latest)}]`
        : latest
    const { messages } = await buildDmContext(userId, username, latestText, latest, {
      compressIfOver: DM_COMPRESS_HARD_MSGS,
    })
    const pk = pairKey(userId, MENGMEGZI_USER_ID)

    // 6. 表情包频率助推：prompt 已引导「频繁发」，但模型常偏保守。
    //    按概率在上下文末尾临时注入一条 system 提示，推高本轮带表情包的命中率。
    //    该提示只活在本次请求里、不写库、不进历史记忆——下轮重新掷骰。
    //    放在 messages 末尾（紧贴模型要回复的位置）效果最直接。
    const wantSticker = Math.random() < DM_STICKER_INJECT_PROBABILITY
    // any[]：工具循环里会追加 assistant(tool_calls) 和 tool 结果
    const finalMessages: any[] = wantSticker
      ? [
          ...messages,
          {
            role: "system",
            content:
              "本轮回复请带上一个表情包（在 replies 里单独放一条 [s:表情名]），挑一个最贴合当下情绪的。注意表情名只能从清单里选。",
          },
        ]
      : messages

    // 7. 联网搜索：配了 TAVILY_API_KEY 才启用，由模型自行决定何时调用
    //    （日常闲聊/情感陪伴不调，仅问最新/实时信息时调）。未配置则 tools 为空、
    //    单次调用，行为与从前一致（优雅降级）。
    const webSearch = isWebSearchEnabled()
    const tools = webSearch ? [WEB_SEARCH_TOOL] : undefined
    // 工具调用循环：最多 MAX_SEARCH_ROUNDS 轮搜索，末轮强制出文字答案
    // （tool_choice:"none"），既控成本也保证一定有最终回复。
    const MAX_SEARCH_ROUNDS = 2
    let rawReply = ""

    for (let round = 0; round <= MAX_SEARCH_ROUNDS; round++) {
      const isLastRound = round === MAX_SEARCH_ROUNDS
      const reqBody: Record<string, unknown> = {
        model: cfg.model,
        messages: finalMessages,
        max_tokens: MAX_REPLY_TOKENS,
        temperature: 0.85,
      }
      if (tools) {
        reqBody.tools = tools
        reqBody.tool_choice = isLastRound ? "none" : "auto"
      }

      const aiResponse = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(reqBody),
      })
      if (!aiResponse.ok) {
        const errText = await aiResponse.text()
        console.error("[HanakoDM] 模型错误:", aiResponse.status, errText)
        return NextResponse.json({ error: "AI 服务暂时不可用" }, { status: 502 })
      }
      const aiData = await aiResponse.json()
      await logPlatformUsage("mimo", "tokens", aiData?.usage?.total_tokens, { source: "dm" })
      const choice = aiData.choices?.[0]
      const aiMsg = choice?.message
      const toolCalls = aiMsg?.tool_calls

      // 模型要求联网搜索 → 执行后把结果回灌，进入下一轮
      if (tools && !isLastRound && Array.isArray(toolCalls) && toolCalls.length > 0) {
        finalMessages.push(aiMsg) // 带 tool_calls 的 assistant 轮，需原样回传
        for (const tc of toolCalls) {
          let query = ""
          try {
            query = JSON.parse(tc.function?.arguments || "{}").query || ""
          } catch {
            // 参数解析失败，给空结果让模型自己兜底
          }
          const result = query ? await searchWeb(query) : "（无效的搜索请求）"
          finalMessages.push({ role: "tool", tool_call_id: tc.id, content: result })
        }
        continue
      }

      // 拿到最终文字回复
      rawReply = (aiMsg?.content || "").trim()
      break
    }

    const { replies, optOut } = parseReplies(rawReply)

    // 兜底：模型正文为空（推理模型 thinking 吃满 token 预算 / 模型异常未输出）时，
    // 不再静默 500——给一条友好回复，让主人知道萌萌子收到了、只是答不上来。
    // 仍记 warn 便于排查根因（看 rawReply 是不是真空、还是格式问题）。
    let finalReplies = replies
    if (replies.length === 0) {
      console.warn("[HanakoDM] 解析回复失败，走兜底:", JSON.stringify(rawReply.slice(0, 80)))
      finalReplies = ["唔……萌萌子想了半天，这个一下子不知道该怎么回你 にゃ（挠头）"]
    }

    // 8. 护栏状态：opt-out 或重置未回计数（用户回应了说明在聊）
    if (optOut) {
      await dmSupabaseAdmin
        .from("hanako_dm_state")
        .upsert({ user_id: userId, opted_out: true, updated_at: new Date().toISOString() })
    } else {
      await dmSupabaseAdmin
        .from("hanako_dm_state")
        .upsert({ user_id: userId, unanswered_streak: 0, updated_at: new Date().toISOString() })
    }

    // 9. 逐条写入（service role 绕 RLS）。多条之间间隔 REPLY_GAP_MS 依次插入，
    //    并显式递增 created_at —— 既保证历史查询的时间顺序，也让对方客户端经
    //    dm_incoming / dm_<pair> 实时订阅先后收到，呈现「连续发来多条」的节奏感。
    //    表情包处理：DM 气泡不支持内联图文混排，故用 splitRepliesIntoRows 把每条 reply
    //    拆成有序的 text/sticker 行——纯表情/纯文本各 1 行，混合消息按原顺序拆成多行
    //    （避免旧逻辑把整条当文本、剥掉表情标记导致表情包丢失）。未知 [s:xxx] 当文本保留。
    const baseTs = Date.now()
    let written = 0
    for (const reply of finalReplies) {
      for (const row of splitRepliesIntoRows(reply)) {
        const content =
          row.kind === "sticker" ? row.content : row.content.slice(0, 500)
        if (!content) continue // 跳过空内容
        if (written > 0) await sleep(REPLY_GAP_MS)
        // created_at 按已写出条数递增 1ms，保证多条顺序稳定（不与同毫秒的其它行碰撞）
        const createdAt = new Date(baseTs + written).toISOString()
        const { error: insertError } = await dmSupabaseAdmin.from("dm_messages").insert([
          {
            pair_key: pk,
            sender_id: MENGMEGZI_USER_ID,
            recipient_id: userId,
            kind: row.kind,
            content,
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
    }
    if (written === 0) {
      return NextResponse.json({ error: "写入失败" }, { status: 500 })
    }

    // 返回合并后的全文（兼容旧返回结构）；客户端是 fire-and-forget，不读返回值，
    // 回复纯靠 realtime 推送，故这里返回什么不影响前端逐条呈现。
    return NextResponse.json({ reply: finalReplies.join("\n"), replies: finalReplies, optOut })
  } catch (error: any) {
    console.error("[HanakoDM] 未知错误:", error)
    return NextResponse.json({ error: error?.message || "服务器内部错误" }, { status: 500 })
  } finally {
    if (userId) dmRateLimiter.endCall(userId)
  }
}
