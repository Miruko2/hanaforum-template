import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// 统计「曾参与用户数」：曾发帖/评论/弹幕/私信/聊天的去重用户数(真实参与用户)。
// 跨 5 张内容表去重 PostgREST 做不到，故走只读函数 public.count_engaged_users()
// (SECURITY DEFINER，仅 service_role 可执行)。
// 需先在 Supabase 跑 scripts/2026-06-21-admin-engaged-users.sql 建好该函数。
export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// 鉴权：必须是登录用户且在 admin_users 表里(与其它 admin API 一致)
async function requireAdmin(
  req: NextRequest,
): Promise<{ ok: true; userId: string } | { ok: false; res: NextResponse }> {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : ""
  if (!token) {
    return { ok: false, res: NextResponse.json({ error: "未登录" }, { status: 401 }) }
  }
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !authData?.user) {
    return { ok: false, res: NextResponse.json({ error: "认证失败或已过期" }, { status: 401 }) }
  }
  const { data: adminRow, error: adminErr } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle()
  if (adminErr) {
    console.error("[engaged-count] 管理员查询错误:", adminErr)
    return { ok: false, res: NextResponse.json({ error: "服务器错误" }, { status: 500 }) }
  }
  if (!adminRow) {
    return { ok: false, res: NextResponse.json({ error: "无权限(非管理员)" }, { status: 403 }) }
  }
  return { ok: true, userId: authData.user.id }
}

// GET: 返回曾参与用户数(去重)
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res
  try {
    const { data, error } = await supabaseAdmin.rpc("count_engaged_users")
    if (error) throw error
    const engagedCount = typeof data === "number" ? data : Number(data) || 0
    return NextResponse.json({ engagedCount })
  } catch (error: any) {
    console.error("[engaged-count] GET 错误:", error)
    return NextResponse.json({ error: error.message || "查询失败" }, { status: 500 })
  }
}
