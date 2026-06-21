// 内容审核 admin 路由共用的鉴权 + service-role 客户端。
// 注意：本文件名不是 route.ts，故不会成为 API 端点，仅供同目录路由 import。
// 鉴权口径与其它 admin 路由（如 dm-ai-config）一致：登录 + 在 admin_users 表。

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function requireAdmin(
  req: NextRequest,
): Promise<{ ok: true; userId: string } | { ok: false; res: NextResponse }> {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : ""
  if (!token) return { ok: false, res: NextResponse.json({ error: "未登录" }, { status: 401 }) }

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
    console.error("[moderation] 管理员查询错误:", adminErr)
    return { ok: false, res: NextResponse.json({ error: "服务器错误" }, { status: 500 }) }
  }
  if (!adminRow) {
    return { ok: false, res: NextResponse.json({ error: "无权限（非管理员）" }, { status: 403 }) }
  }
  return { ok: true, userId: authData.user.id }
}

// 约定分类（与 seed / Edge Function 一致；DB 不强制，前端下拉用）
export const CATEGORIES = ["政治", "色情", "辱骂", "广告", "违法"] as const
