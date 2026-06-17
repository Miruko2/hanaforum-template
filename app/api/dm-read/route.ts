import { NextRequest, NextResponse } from "next/server"
import { dmSupabaseAdmin } from "@/lib/hanako/dm-ai"

// 强制动态渲染
export const dynamic = "force-dynamic"

/**
 * 私信已读回执：接收方打开会话时把「对方发给我、且尚未读」的消息置 read_at=now()。
 *
 * 安全：
 *   - Bearer token → dmSupabaseAdmin.auth.getUser 取可信 userId；
 *   - service_role UPDATE，WHERE 限定 recipient_id=userId 且 read_at IS NULL，
 *     即只能标记「发给我」的消息、且单向 NULL→now 不可回退；
 *   - 客户端无 dm_messages 的 UPDATE RLS，绕不过此路由。
 *
 * 发送方经 realtime（dm_${pair_key} channel 订阅 UPDATE）实时收到 read_at 变化，
 * 对应气泡出现「已读」。
 */
export async function POST(req: NextRequest) {
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
    const userId = authData.user.id

    // 2. 取 pair_key 并做基本校验（必须形如 "uidA:uidB" 且包含自己）
    const body = (await req.json().catch(() => ({}))) as { pair_key?: string }
    const pk = typeof body.pair_key === "string" ? body.pair_key.trim() : ""
    if (!pk || !pk.includes(userId)) {
      return NextResponse.json({ error: "非法的 pair_key", code: "bad_pair_key" }, { status: 400 })
    }

    // 3. service_role 一次性把「发给我、未读」的消息置已读
    const { data, error } = await dmSupabaseAdmin
      .from("dm_messages")
      .update({ read_at: new Date().toISOString() })
      .match({ pair_key: pk, recipient_id: userId })
      .is("read_at", null)
      .select("id")

    if (error) {
      console.error("[dm-read] UPDATE 失败:", error.message)
      return NextResponse.json({ error: "标记已读失败", code: "db_error" }, { status: 500 })
    }

    return NextResponse.json({ status: "ok", updated: Array.isArray(data) ? data.length : 0 })
  } catch (e) {
    console.error("[dm-read] 异常:", e)
    return NextResponse.json({ error: "服务器错误", code: "server_error" }, { status: 500 })
  }
}
