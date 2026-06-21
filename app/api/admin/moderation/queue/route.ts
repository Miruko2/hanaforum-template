// 审核队列：GET 列表（默认 pending，补作者用户名 + pending 总数）/ POST 处理（approve 放行 / remove 删原内容）。
import { NextRequest, NextResponse } from "next/server"
import { requireAdmin, supabaseAdmin } from "../guard"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  const url = new URL(req.url)
  const status = url.searchParams.get("status") || "pending"
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500)
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0)

  const { data, error, count } = await supabaseAdmin
    .from("moderation_queue")
    .select(
      "id, table_name, record_id, user_id, content, category, matched, source, status, created_at",
      { count: "exact" },
    )
    .eq("status", status)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 补作者用户名（moderation_queue.user_id 无外键到 profiles，单独批量查后内存合并）
  const rows = (data ?? []) as any[]
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
  const nameMap: Record<string, string> = {}
  if (ids.length) {
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, username").in("id", ids)
    for (const p of (profs ?? []) as any[]) nameMap[p.id] = p.username || ""
  }
  const items = rows.map((r) => ({ ...r, username: nameMap[r.user_id] || null }))

  // pending 总数（给 tab 角标 / 红点用）
  const { count: pendingCount } = await supabaseAdmin
    .from("moderation_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")

  return NextResponse.json({ items, total: count ?? 0, pendingCount: pendingCount ?? 0 })
}

// 删原内容（与 moderate-text 的 block 删除同口径；跨 Deno/Node 无法共享，复制一份）
async function removeOriginalContent(table: string, recordId: string): Promise<void> {
  if (table === "posts") {
    await supabaseAdmin.from("comments").delete().eq("post_id", recordId)
    await supabaseAdmin.from("likes").delete().eq("post_id", recordId)
    await supabaseAdmin.from("posts").delete().eq("id", recordId)
  } else if (table === "comments") {
    await supabaseAdmin.from("comment_likes").delete().eq("comment_id", recordId)
    await supabaseAdmin.from("comments").delete().eq("id", recordId)
  } else if (table === "live_comments") {
    await supabaseAdmin.from("live_comments").delete().eq("id", recordId)
  } else if (table === "chat_messages") {
    await supabaseAdmin.from("chat_messages").delete().eq("id", recordId)
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  const body = await req.json().catch(() => ({}))
  const id = body.id
  const action = body.action
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 })
  if (action !== "approve" && action !== "remove") {
    return NextResponse.json({ error: "action 非法（approve / remove）" }, { status: 400 })
  }

  const { data: row, error: getErr } = await supabaseAdmin
    .from("moderation_queue")
    .select("id, table_name, record_id, status")
    .eq("id", id)
    .maybeSingle()
  if (getErr) return NextResponse.json({ error: getErr.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: "队列项不存在" }, { status: 404 })

  // remove：删掉原内容（原内容可能已被作者自删，delete 影响 0 行也无妨）
  if (action === "remove") {
    await removeOriginalContent((row as any).table_name, (row as any).record_id)
  }

  const { error: upErr } = await supabaseAdmin
    .from("moderation_queue")
    .update({
      status: action === "remove" ? "removed" : "approved",
      reviewed_at: new Date().toISOString(),
      reviewed_by: auth.userId,
    })
    .eq("id", id)
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
