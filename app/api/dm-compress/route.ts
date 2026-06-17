import { NextRequest, NextResponse } from "next/server"
import dmRateLimiter from "@/lib/hanako/dm-rate-limit"
import { dmSupabaseAdmin } from "@/lib/hanako/dm-ai"
import { MENGMEGZI_USER_ID, DM_COMPRESS_TRIGGER_MSGS } from "@/lib/hanako/constants"
import { compactDmContext } from "@/lib/hanako/dm-context"

// 强制动态渲染
export const dynamic = "force-dynamic"

/**
 * 私信会话空闲预压缩。
 *
 * 客户端在聊天窗空闲（无新消息一小段时间）且当前在和萌萌子私聊、消息够多时，静默调本路由：
 *   - compactDmContext 内部判定未摘要是否超 TRIGGER 阈值（条数/token）；
 *   - 超过则把最老的折叠进摘要、写回，返回 { compressed: true }；
 *   - 未超过则零成本返回 { compressed: false }（不调摘要模型）。
 *
 * 目的：让压缩发生在两次回复之间的空闲期，回复路由里极少需要同步压缩，避免回复卡顿。
 */
export async function POST(req: NextRequest) {
  let userId = ""
  try {
    const authHeader = req.headers.get("authorization") || ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
    if (!token) {
      return NextResponse.json({ error: "未登录", code: "missing_auth" }, { status: 401 })
    }
    const { data: authData, error: authError } = await dmSupabaseAdmin.auth.getUser(token)
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "登录已过期", code: "invalid_auth" }, { status: 401 })
    }
    userId = authData.user.id
    if (userId === MENGMEGZI_USER_ID) {
      return NextResponse.json({ skipped: true })
    }

    // 限流：复用私信限流器，避免压缩请求挤占回复
    const rc = dmRateLimiter.checkRateLimit(userId)
    if (!rc.allowed) {
      return NextResponse.json({ skipped: true, reason: "rate_limited" })
    }
    dmRateLimiter.startCall(userId)

    const username =
      (authData.user.user_metadata?.username as string | undefined) ||
      (authData.user.email ? authData.user.email.split("@")[0] : null) ||
      "主人"
    // 空闲触发点 TRIGGER：未摘要超阈值才真折叠写回，否则零成本返回 compressed:false
    const { compressed } = await compactDmContext(userId, username, DM_COMPRESS_TRIGGER_MSGS)

    return NextResponse.json({ compressed })
  } catch (error: any) {
    console.error("[DmCompress] 未知错误:", error)
    return NextResponse.json({ error: error?.message || "服务器内部错误" }, { status: 500 })
  } finally {
    if (userId) dmRateLimiter.endCall(userId)
  }
}
