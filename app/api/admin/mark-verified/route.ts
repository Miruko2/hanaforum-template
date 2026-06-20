import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// 管理员手动把某用户标记为「邮箱已验证」——解卡阀门。
// 用途：强制验证(enforce_all)后，用死邮箱注册的真实用户被卡住时，后台一键放行。
export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    console.error("[mark-verified] 管理员查询错误:", adminErr)
    return { ok: false, res: NextResponse.json({ error: "服务器错误" }, { status: 500 }) }
  }
  if (!adminRow) {
    return { ok: false, res: NextResponse.json({ error: "无权限(非管理员)" }, { status: 403 }) }
  }
  return { ok: true, userId: authData.user.id }
}

// POST { userId }: 把该用户标记为已验证
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res
  try {
    const body = (await req.json().catch(() => ({}))) as { userId?: string }
    const userId = String(body.userId || "").trim()
    if (!UUID_RE.test(userId)) {
      return NextResponse.json({ error: "userId 不合法" }, { status: 400 })
    }
    const { error } = await supabaseAdmin
      .from("email_verifications")
      .upsert(
        { user_id: userId, verified_at: new Date().toISOString(), code_hash: null },
        { onConflict: "user_id" },
      )
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error("[mark-verified] POST 错误:", error)
    return NextResponse.json({ error: error.message || "操作失败" }, { status: 500 })
  }
}
