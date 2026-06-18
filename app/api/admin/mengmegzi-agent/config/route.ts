// app/api/admin/mengmegzi-agent/config/route.ts
//
// 配置读写端点（admin）。

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

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
    .from("mengmegzi_config")
    .select(
      "comment_polling_enabled, comment_interval_min, comment_scan_hours, busy_timeout_min, image_sources, updated_at",
    )
    .eq("id", 1)
    .maybeSingle()
  return NextResponse.json(data || {})
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as {
    comment_polling_enabled?: boolean
    comment_interval_min?: number
    comment_scan_hours?: number
    busy_timeout_min?: number
  }
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (typeof body.comment_polling_enabled === "boolean")
    patch.comment_polling_enabled = body.comment_polling_enabled
  if (typeof body.comment_interval_min === "number")
    patch.comment_interval_min = Math.min(Math.max(Math.round(body.comment_interval_min), 1), 1440)
  if (typeof body.comment_scan_hours === "number")
    patch.comment_scan_hours = Math.min(Math.max(Math.round(body.comment_scan_hours), 1), 168)
  if (typeof body.busy_timeout_min === "number")
    patch.busy_timeout_min = Math.min(Math.max(Math.round(body.busy_timeout_min), 1), 60)

  const { error } = await supabaseAdmin.from("mengmegzi_config").update(patch).eq("id", 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
