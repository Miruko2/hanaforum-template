import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import rateLimiter from "@/lib/hanako/rate-limit"
import { HANAKO_SYSTEM_PROMPT, buildUserMessage } from "@/lib/hanako/prompt"
import {
  HANAKO_USER_ID,
  HANAKO_USERNAME,
  EMOTIONS,
  MAX_REPLY_TOKENS,
  type HanakoEmotion,
} from "@/lib/hanako/constants"

// 强制动态渲染（不被静态导出影响）
export const dynamic = "force-dynamic"

// 用 service role 创建 Supabase 客户端（绕过 RLS）
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(req: NextRequest) {
  let userId = ""

  try {
    // 调试日志：记录 Cloudflare 相关头，用于排查 403 来源
    const cfRay = req.headers.get("cf-ray")
    const cfConnectingIp = req.headers.get("cf-connecting-ip")
    const cfVisitor = req.headers.get("cf-visitor")
    const userAgent = req.headers.get("user-agent")
    console.log("[Hanako] 收到请求:", {
      cfRay,
      cfConnectingIp,
      cfVisitor,
      userAgent,
      url: req.url,
    })

    const body = await req.json()
    const parsed = body as {
      userId: string
      username: string
      content: string
      recentMessages?: { username: string; content: string }[]
    }
    userId = parsed.userId

    if (!parsed.userId || !parsed.username || !parsed.content) {
      console.warn("[Hanako] 缺少必要参数:", { userId: parsed.userId, username: parsed.username, content: parsed.content })
      return NextResponse.json({ error: "缺少必要参数" }, { status: 400 })
    }

    // 白名单检查（从数据库读取）
    const { data: allowedUsers, error: allowedError } = await supabaseAdmin
      .from("hanako_allowed_users")
      .select("user_id")
      .eq("user_id", parsed.userId)
      .maybeSingle()

    if (allowedError) {
      console.error("[Hanako] 白名单查询错误:", allowedError)
    }

    // 如果白名单表存在且用户不在白名单中，拒绝访问
    if (!allowedUsers) {
      console.warn("[Hanako] 白名单拒绝:", { userId: parsed.userId })
      return NextResponse.json(
        { error: "你没有与 hanako 对话的权限（白名单检查未通过）" },
        { status: 403 },
      )
    }
    console.log("[Hanako] 白名单通过:", { userId: parsed.userId })

    // 限流检查
    const rateCheck = rateLimiter.checkRateLimit(parsed.userId)
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: rateCheck.reason }, { status: 429 })
    }

    rateLimiter.startCall(parsed.userId)

    // 调用 DeepSeek
    const apiKey = process.env.DEEPSEEK_API_KEY
    const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1"

    if (!apiKey) {
      console.error("[Hanako] DEEPSEEK_API_KEY 未配置")
      return NextResponse.json({ error: "AI 服务未配置" }, { status: 500 })
    }

    const userMessage = buildUserMessage(
      parsed.username,
      parsed.content,
      parsed.recentMessages || [],
    )

    const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        messages: [
          { role: "system", content: HANAKO_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: MAX_REPLY_TOKENS,
        temperature: 0.85,
      }),
    })

    if (!aiResponse.ok) {
      const errText = await aiResponse.text()
      console.error("[Hanako] DeepSeek API 错误:", aiResponse.status, errText)
      return NextResponse.json({ error: "AI 服务暂时不可用" }, { status: 502 })
    }

    const aiData = await aiResponse.json()
    const rawReply = aiData.choices?.[0]?.message?.content?.trim() || ""

    // 解析 JSON 回复
    let emotion: HanakoEmotion = "neutral"
    let reply = ""

    try {
      const parsed = JSON.parse(rawReply)
      emotion = EMOTIONS.includes(parsed.emotion) ? parsed.emotion : "neutral"
      reply = parsed.reply || ""
    } catch {
      const jsonMatch = rawReply.match(/\{[\s\S]*?"emotion"[\s\S]*?"reply"[\s\S]*?\}/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0])
          emotion = EMOTIONS.includes(parsed.emotion) ? parsed.emotion : "neutral"
          reply = parsed.reply || ""
        } catch {
          reply = rawReply.slice(0, 100)
        }
      } else {
        reply = rawReply.slice(0, 100)
      }
    }

    if (!reply) {
      return NextResponse.json({ error: "AI 未生成有效回复" }, { status: 500 })
    }

    // 将 AI 回复写入 live_comments
    const { error: insertError } = await supabaseAdmin
      .from("live_comments")
      .insert([
        {
          user_id: HANAKO_USER_ID,
          username: HANAKO_USERNAME,
          content: reply,
        },
      ])

    if (insertError) {
      console.error("[Hanako] 写入 live_comments 失败:", insertError)
    }

    return NextResponse.json({ emotion, reply })
  } catch (error: any) {
    console.error("[Hanako] 未知错误:", error)
    return NextResponse.json(
      { error: error.message || "服务器内部错误" },
      { status: 500 },
    )
  } finally {
    if (userId) rateLimiter.endCall(userId)
  }
}
