import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { requireAdmin, supabaseAdmin } from "@/lib/admin-auth"

// 友链管理（管理员）：增 / 删 / 改 / 列表。写入用 service_role 绕 RLS。
// 任何改动后 revalidatePath('/links') —— /links 是 ISR 缓存的服务端组件，改完即时刷新。
export const dynamic = "force-dynamic"

const MAX = { name: 60, url: 300, desc: 200, icon: 300, tag: 30 }
const CATEGORIES = ["friend", "nav"] as const

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

// 校验并归一一条友链字段（用于 POST 全量 / PATCH 增量）。返回 {error} 或 {value}
function pickFields(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {}

  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? "").trim()
    if (!name || name.length > MAX.name) return { error: "站名必填，且不超过 60 字" }
    out.name = name
  }
  if (!partial || body.url !== undefined) {
    const url = String(body.url ?? "").trim()
    if (!url || url.length > MAX.url || !isHttpUrl(url)) return { error: "请填写合法的网址（http/https）" }
    out.url = url
  }
  if (!partial || body.description !== undefined) {
    const d = String(body.description ?? "").trim()
    if (d.length > MAX.desc) return { error: "简介不超过 200 字" }
    out.description = d || null
  }
  if (!partial || body.icon_url !== undefined) {
    const ic = String(body.icon_url ?? "").trim()
    if (ic && (ic.length > MAX.icon || !isHttpUrl(ic))) return { error: "icon 链接需是合法 http/https 地址" }
    out.icon_url = ic || null
  }
  if (!partial || body.tag !== undefined) {
    const t = String(body.tag ?? "").trim()
    if (t.length > MAX.tag) return { error: "标签不超过 30 字" }
    out.tag = t || null
  }
  if (!partial || body.category !== undefined) {
    const c = String(body.category ?? "friend")
    if (!CATEGORIES.includes(c as (typeof CATEGORIES)[number])) return { error: "分区不合法" }
    out.category = c
  }
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order)
    if (!Number.isFinite(n)) return { error: "排序值不合法" }
    out.sort_order = Math.trunc(n)
  }
  if (body.is_visible !== undefined) {
    out.is_visible = !!body.is_visible
  }
  return { value: out }
}

// GET：列出全部友链（含隐藏），按分区 + sort_order
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res
  const { data, error } = await supabaseAdmin
    .from("friend_links")
    .select("*")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
  if (error) {
    console.error("[admin/friend-links] GET 失败:", error)
    return NextResponse.json({ error: "读取失败" }, { status: 500 })
  }
  return NextResponse.json({ links: data ?? [] })
}

// POST：新增一条友链
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const picked = pickFields(body, false)
  if ("error" in picked) return NextResponse.json({ error: picked.error }, { status: 400 })

  const row = picked.value as { category: string; sort_order?: number }
  // 没给排序就追加到该分区末尾
  if (row.sort_order === undefined) {
    const { data: last } = await supabaseAdmin
      .from("friend_links")
      .select("sort_order")
      .eq("category", row.category)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle()
    row.sort_order = (last?.sort_order ?? -1) + 1
  }

  const { data, error } = await supabaseAdmin.from("friend_links").insert(row).select("*").single()
  if (error) {
    console.error("[admin/friend-links] POST 失败:", error)
    return NextResponse.json({ error: "新增失败" }, { status: 500 })
  }
  revalidatePath("/links")
  return NextResponse.json({ link: data })
}

// PATCH：更新一条友链（增量字段）
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const id = String(body.id ?? "").trim()
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 })

  const picked = pickFields(body, true)
  if ("error" in picked) return NextResponse.json({ error: picked.error }, { status: 400 })
  const patch = { ...picked.value, updated_at: new Date().toISOString() }

  const { data, error } = await supabaseAdmin
    .from("friend_links")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single()
  if (error) {
    console.error("[admin/friend-links] PATCH 失败:", error)
    return NextResponse.json({ error: "更新失败" }, { status: 500 })
  }
  revalidatePath("/links")
  return NextResponse.json({ link: data })
}

// DELETE：删除一条友链（?id=）
export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res
  const id = req.nextUrl.searchParams.get("id")?.trim()
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 })

  const { error } = await supabaseAdmin.from("friend_links").delete().eq("id", id)
  if (error) {
    console.error("[admin/friend-links] DELETE 失败:", error)
    return NextResponse.json({ error: "删除失败" }, { status: 500 })
  }
  revalidatePath("/links")
  return NextResponse.json({ ok: true })
}
