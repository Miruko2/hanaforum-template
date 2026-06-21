// 管理端 API 的统一鉴权 + service_role 客户端。
// 用法：路由开头 const auth = await requireAdmin(req); if (!auth.ok) return auth.res
// 鉴权口径与其它 admin API 一致：登录 + 命中 admin_users 表。
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type AdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; res: NextResponse }

export async function requireAdmin(req: NextRequest): Promise<AdminAuthResult> {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : ""
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
    console.error("[admin-auth] 管理员查询错误:", adminErr)
    return { ok: false, res: NextResponse.json({ error: "服务器错误" }, { status: 500 }) }
  }
  if (!adminRow) {
    return { ok: false, res: NextResponse.json({ error: "无权限(非管理员)" }, { status: 403 }) }
  }
  return { ok: true, userId: authData.user.id }
}
