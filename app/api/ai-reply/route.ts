import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import rateLimiter from "@/lib/hanako/rate-limit"
import { buildSystemPrompt, buildUserMessage } from "@/lib/hanako/prompt"
import { isWebSearchEnabled, searchWeb, WEB_SEARCH_TOOL } from "@/lib/hanako/web-search"
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

// ── AI 配置缓存 ─────────────────────────────────────────────
// 每次 AI 调用都查表会浪费 DB 配额；缓存 10s 即可让"管理员改完配置"
// 在 10 秒内全网生效，对用户体验和 DB 都友好
type AIConfig = {
  baseUrl: string
  apiKey: string
  model: string
  // 是否启用 hanako 对话白名单：
  // true  → 只有 hanako_allowed_users 表里的用户能调用
  // false → 任何登录用户都能调用（仍受 rate_limit 限制）
  // 默认 true，保证 ai_config 表里这列还没建好时也保持"白名单生效"
  whitelistEnabled: boolean
}
let aiConfigCache: { value: AIConfig; expireAt: number } | null = null
const AI_CONFIG_CACHE_TTL = 10_000 // 10 秒

async function loadAIConfig(): Promise<AIConfig> {
  const now = Date.now()
  if (aiConfigCache && aiConfigCache.expireAt > now) {
    return aiConfigCache.value
  }

  // 环境变量兜底（仅用于 DB 没值时的 fallback）
  const envFallback: AIConfig = {
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    whitelistEnabled: true,
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("ai_config")
      .select("base_url, api_key, model, whitelist_enabled")
      .eq("id", 1)
      .maybeSingle()

    if (error) {
      // 表可能还没建（首次部署），不要打死服务
      console.warn("[Hanako] 读取 ai_config 失败，回退到环境变量:", error.message)
      aiConfigCache = { value: envFallback, expireAt: now + AI_CONFIG_CACHE_TTL }
      return envFallback
    }

    // 任一字段为空就拿环境变量补齐
    const merged: AIConfig = {
      baseUrl:
        (data?.base_url && data.base_url.trim()) || envFallback.baseUrl,
      apiKey: (data?.api_key && data.api_key.trim()) || envFallback.apiKey,
      model: (data?.model && data.model.trim()) || envFallback.model,
      // 字段缺失（迁移还没跑）或为 null 时，回退到默认 true
      whitelistEnabled:
        typeof data?.whitelist_enabled === "boolean"
          ? data.whitelist_enabled
          : true,
    }

    aiConfigCache = { value: merged, expireAt: now + AI_CONFIG_CACHE_TTL }
    return merged
  } catch (err: any) {
    console.warn("[Hanako] 读取 ai_config 异常，回退到环境变量:", err?.message)
    aiConfigCache = { value: envFallback, expireAt: now + AI_CONFIG_CACHE_TTL }
    return envFallback
  }
}

// 注：serverless 环境下每个函数 instance 内存独立，跨路由清缓存无意义。
// 管理员改完配置最多 10s（TTL）后全网生效，已经足够。

export async function POST(req: NextRequest) {
  let userId = ""

  try {
    // 1. 身份校验：必须带 Bearer token，用 Supabase 验签后才信任 user_id
    //    这是这条路由的唯一可信 user 来源，body 里的 userId/username 一律忽略
    const authHeader = req.headers.get("authorization") || ""
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : ""

    if (!token) {
      return NextResponse.json(
        { error: "缺少认证信息（未登录）", code: "missing_auth" },
        { status: 401 },
      )
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !authData?.user) {
      return NextResponse.json(
        { error: "认证失败或登录已过期", code: "invalid_auth" },
        { status: 401 },
      )
    }
    const authUser = authData.user
    userId = authUser.id

    // 2. 解析 body —— 只信任 content 和 recentMessages，userId/username 从 token 派生
    const body = (await req.json()) as {
      content?: string
      recentMessages?: { username: string; content: string }[]
    }

    if (!body.content || typeof body.content !== "string") {
      return NextResponse.json({ error: "缺少必要参数 content" }, { status: 400 })
    }

    // 与前端 MAX_LENGTH / DB CHECK 对齐，防止超长内容打到上游
    if (body.content.length > 50) {
      return NextResponse.json({ error: "内容超过长度限制" }, { status: 400 })
    }

    // 派生用户名（用于 prompt 中称呼，不影响身份校验）
    const username: string =
      (authUser.user_metadata?.username as string | undefined) ||
      (authUser.email ? authUser.email.split("@")[0] : null) ||
      "匿名"

    // 3. 加载 AI 配置（含白名单开关）
    //    放在白名单检查之前：开关关掉时跳过 DB 查询，省一次查询
    const { baseUrl, apiKey, model, whitelistEnabled } = await loadAIConfig()

    // 4. 白名单检查（仅在 whitelistEnabled=true 时执行）
    //    关闭白名单时，任何登录用户都能继续往下走
    if (whitelistEnabled) {
      const { data: allowedUsers, error: allowedError } = await supabaseAdmin
        .from("hanako_allowed_users")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle()

      if (allowedError) {
        console.error("[Hanako] 白名单查询错误:", allowedError)
      }

      if (!allowedUsers) {
        return NextResponse.json(
          {
            error: "你没有与 hanako 对话的权限（白名单检查未通过）",
            code: "not_whitelisted",
          },
          { status: 403 },
        )
      }
    }

    // 5. 限流检查（白名单开关与否都生效，避免滥用）
    const rateCheck = rateLimiter.checkRateLimit(userId)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.reason, code: "rate_limited" },
        { status: 429 },
      )
    }

    rateLimiter.startCall(userId)

    if (!apiKey) {
      console.error("[Hanako] api_key 未配置（ai_config 表和环境变量都为空）")
      return NextResponse.json({ error: "AI 服务未配置" }, { status: 500 })
    }

    const userMessage = buildUserMessage(
      username,
      body.content,
      body.recentMessages || [],
    )

    // 联网搜索：仅在配置了搜索 key 时启用。未配置 → tools 为空、单次调用，
    // 行为与从前完全一致（优雅降级，绝不影响现有回复路径）。
    const webSearch = isWebSearchEnabled()
    // 消息数组在工具循环里会追加 assistant(tool_calls) 和 tool 结果，故用 any[]
    const messages: any[] = [
      { role: "system", content: buildSystemPrompt({ webSearchEnabled: webSearch }) },
      { role: "user", content: userMessage },
    ]
    const tools = webSearch ? [WEB_SEARCH_TOOL] : undefined

    // 工具调用循环：最多 MAX_SEARCH_ROUNDS 轮搜索，末轮强制出文字答案
    // （tool_choice:"none"），既控成本也保证一定有最终回复。
    const MAX_SEARCH_ROUNDS = 2
    let rawReply = ""
    let finishReason: string | undefined

    for (let round = 0; round <= MAX_SEARCH_ROUNDS; round++) {
      const isLastRound = round === MAX_SEARCH_ROUNDS
      const reqBody: Record<string, unknown> = {
        model,
        messages,
        max_tokens: MAX_REPLY_TOKENS,
        temperature: 0.85,
      }
      if (tools) {
        reqBody.tools = tools
        reqBody.tool_choice = isLastRound ? "none" : "auto"
      }

      const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(reqBody),
      })

      if (!aiResponse.ok) {
        const errText = await aiResponse.text()
        console.error("[Hanako] DeepSeek API 错误:", aiResponse.status, errText)
        return NextResponse.json({ error: "AI 服务暂时不可用" }, { status: 502 })
      }

      const aiData = await aiResponse.json()
      const choice = aiData.choices?.[0]
      const aiMsg = choice?.message
      finishReason = choice?.finish_reason
      const toolCalls = aiMsg?.tool_calls

      // 模型要求联网搜索 → 执行后把结果回灌，进入下一轮
      if (tools && !isLastRound && Array.isArray(toolCalls) && toolCalls.length > 0) {
        messages.push(aiMsg) // 带 tool_calls 的 assistant 轮，需原样回传
        for (const tc of toolCalls) {
          let query = ""
          try {
            query = JSON.parse(tc.function?.arguments || "{}").query || ""
          } catch {
            // 参数解析失败，给空结果让模型自己兜底
          }
          const result = query ? await searchWeb(query) : "（无效的搜索请求）"
          messages.push({ role: "tool", tool_call_id: tc.id, content: result })
        }
        continue
      }

      // 拿到最终文字回复
      rawReply = (aiMsg?.content || "").trim()
      break
    }

    // 解析 JSON 回复
    let emotion: HanakoEmotion = "neutral"
    let reply = ""

    // 去掉可能的 markdown 代码块包装：```json ... ``` 或 ``` ... ```
    const cleaned = rawReply
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim()

    try {
      const parsed = JSON.parse(cleaned)
      emotion = EMOTIONS.includes(parsed.emotion) ? parsed.emotion : "neutral"
      reply = typeof parsed.reply === "string" ? parsed.reply : ""
    } catch {
      // 尝试从混入文本中抽完整 JSON
      const jsonMatch = cleaned.match(/\{[\s\S]*?"emotion"[\s\S]*?"reply"[\s\S]*?\}/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0])
          emotion = EMOTIONS.includes(parsed.emotion) ? parsed.emotion : "neutral"
          reply = typeof parsed.reply === "string" ? parsed.reply : ""
        } catch {
          // 半截 JSON：解析失败但带有 "reply" 关键字，说明被截断了，丢弃
        }
      } else if (!cleaned.includes('"emotion"') && !cleaned.includes('"reply"')) {
        // 完全不是 JSON 格式的纯文本回复，截断兜底（上限对齐放宽后的 DB 约束）
        reply = cleaned.slice(0, 480)
      }
      // 其他情况（含 "reply" 但解不出来）= 半截 JSON，reply 保持为 ""
    }

    if (!reply) {
      console.warn("[Hanako] 解析回复失败:", { finishReason, rawReplyHead: rawReply.slice(0, 80) })
      const errorMsg =
        finishReason === "length"
          ? "AI 回复被截断，请重试"
          : "AI 未生成有效回复"
      return NextResponse.json({ error: errorMsg }, { status: 500 })
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
