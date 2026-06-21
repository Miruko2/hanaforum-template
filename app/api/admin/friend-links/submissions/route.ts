import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { requireAdmin, supabaseAdmin } from "@/lib/admin-auth"

// 友链「申请」收件箱（管理员）：列出 + 一键审核。
//   approve → 写入 friend_links（category=friend，追加到末尾）+ 标记申请 approved + 记 approved_link_id + 刷新 /links
//   reject / spam → 仅改 status
export const dynamic = "force-dynamic"

// GET：列出申请，默认只看 pending（?status=pending|approved|rejected|spam|all）
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res
  const status = (req.nextUrl.searchParams.get("status") || "pending").trim()

  let query = supabaseAdmin
    .from("friend_link_submissions")
    .select("id, site_name, site_url, icon_url, description, contact, status, created_at, approved_link_id")
    .order("created_at", { ascending: false })
    .limit(200)
  if (status !== "all") query = query.eq("status", status)

  const { data, error } = await query
  if (error) {
    console.error("[admin/friend-links/submissions] GET 失败:", error)
    return NextResponse.json({ error: "读取失败" }, { status: 500 })
  }
  return NextResponse.json({ submissions: data ?? [] })
}

// PATCH { id, action: 'approve' | 'reject' | 'spam' }
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res
  const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string }
  const id = String(body.id ?? "").trim()
  const action = String(body.action ?? "").trim()
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 })

  if (action === "reject" || action === "spam") {
    const status = action === "spam" ? "spam" : "rejected"
    const { error } = await supabaseAdmin
      .from("friend_link_submissions")
      .update({ status })
      .eq("id", id)
    if (error) {
      console.error("[admin/friend-links/submissions] reject/spam 失败:", error)
      return NextResponse.json({ error: "操作失败" }, { status: 500 })
    }
    return NextResponse.json({ ok: true, status })
  }

  if (action === "approve") {
    // 取申请
    const { data: sub, error: subErr } = await supabaseAdmin
      .from("friend_link_submissions")
      .select("id, site_name, site_url, icon_url, description, status, approved_link_id")
      .eq("id", id)
      .single()
    if (subErr || !sub) {
      return NextResponse.json({ error: "申请不存在" }, { status: 404 })
    }
    if (sub.status === "approved" || sub.approved_link_id) {
      return NextResponse.json({ error: "该申请已通过，请勿重复" }, { status: 409 })
    }

    // 追加到 friend 分区末尾
    const { data: last } = await supabaseAdmin
      .from("friend_links")
      .select("sort_order")
      .eq("category", "friend")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    const sort_order = (last?.sort_order ?? -1) + 1

    const { data: link, error: insErr } = await supabaseAdmin
      .from("friend_links")
      .insert({
        name: sub.site_name,
        url: sub.site_url,
        description: sub.description || null,
        icon_url: sub.icon_url || null,
        category: "friend",
        sort_order,
        is_visible: true,
      })
      .select("id")
      .single()
    if (insErr || !link) {
      console.error("[admin/friend-links/submissions] approve 入库友链失败:", insErr)
      return NextResponse.json({ error: "上墙失败" }, { status: 500 })
    }

    const { error: updErr } = await supabaseAdmin
      .from("friend_link_submissions")
      .update({ status: "approved", approved_link_id: link.id })
      .eq("id", id)
    if (updErr) {
      console.error("[admin/friend-links/submissions] approve 标记失败（友链已建）:", updErr)
      // 友链已建好，标记失败不致命，照常返回成功
    }

    revalidatePath("/links")
    return NextResponse.json({ ok: true, status: "approved", linkId: link.id })
  }

  return NextResponse.json({ error: "action 不合法" }, { status: 400 })
}
