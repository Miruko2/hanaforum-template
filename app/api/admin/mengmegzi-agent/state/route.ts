// app/api/admin/mengmegzi-agent/state/route.ts
//
// 状态机读写端点（admin）。复用 dm-ai-config 的 requireAdmin 模式。

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { resetState } from "@/lib/mengmegzi/state"

export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const token = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.slice(7).trim()
    : ""
  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 })
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !auth?.user) return NextResponse.json({ error: "认证失败" }, { status: 401 })
  const { data: adminRow } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle()
  if (!adminRow) return NextResponse.json({ error: "无权限" }, { status: 403 })
  return null
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const { data } = await supabaseAdmin
    .from("mengmegzi_agent_state")
    .select(
      "status, current_task, last_error, last_action_at, last_error_at, busy_since, pending_task, updated_at",
    )
    .eq("id", 1)
    .maybeSingle()
  return NextResponse.json(data || {})
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as { action?: "reset" }
  if (body.action === "reset") {
    await resetState()
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: "未知 action" }, { status: 400 })
}
