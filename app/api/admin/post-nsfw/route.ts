import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// 管理员一键把帖子标记/取消标记为「敏感内容」(is_nsfw)。
// 用途：首页防重口模式 —— 被标记的帖子封面不再展示真实图片，
//       改为模糊背景 + 警告占位（见 components/post-card-image），点击仍可进详情页查看原图。
// 必须用 service_role 绕过 RLS：posts_update 策略只允许作者本人更新自己的帖子，
// 管理员改的是别人的帖，普通客户端写不进去。
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
    console.error("[post-nsfw] 管理员查询错误:", adminErr)
    return { ok: false, res: NextResponse.json({ error: "服务器错误" }, { status: 500 }) }
  }
  if (!adminRow) {
    return { ok: false, res: NextResponse.json({ error: "无权限(非管理员)" }, { status: 403 }) }
  }
  return { ok: true, userId: authData.user.id }
}

// POST { postId, isNsfw }: 把指定帖子的 is_nsfw 置为 true/false
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res
  try {
    const body = (await req.json().catch(() => ({}))) as { postId?: string; isNsfw?: boolean }
    const postId = String(body.postId || "").trim()
    if (!UUID_RE.test(postId)) {
      return NextResponse.json({ error: "postId 不合法" }, { status: 400 })
    }
    const isNsfw = Boolean(body.isNsfw)

    // 只更新单列 is_nsfw，避免触发多余的内容审核 edge function
    // （posts 表有 moderate-text-posts / moderate-post-image 的 AFTER UPDATE 触发器，
    //   但它们针对的是 title/content/image 的实质变更；单列更新影响最小、幂等。）
    const { error } = await supabaseAdmin
      .from("posts")
      .update({ is_nsfw: isNsfw })
      .eq("id", postId)
    if (error) throw error
    return NextResponse.json({ ok: true, is_nsfw: isNsfw })
  } catch (error: any) {
    console.error("[post-nsfw] POST 错误:", error)
    return NextResponse.json({ error: error.message || "操作失败" }, { status: 500 })
  }
}
