// app/api/admin/mengmegzi-agent/log/route.ts
//
// 日志查询端点（admin）。

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
  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200)
  const { data } = await supabaseAdmin
    .from("mengmegzi_action_log")
    .select("id, action_type, target_id, result, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
  return NextResponse.json(data || [])
}
