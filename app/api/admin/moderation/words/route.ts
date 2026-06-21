// 敏感词库管理：GET 列表（支持分类过滤 + 关键词搜索 + 分页）/ POST 增 / PATCH 改 / DELETE 删。
import { NextRequest, NextResponse } from "next/server"
import { requireAdmin, supabaseAdmin, CATEGORIES } from "../guard"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  const url = new URL(req.url)
  const category = url.searchParams.get("category") || ""
  const q = (url.searchParams.get("q") || "").trim()
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 1000)
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0)

  let query = supabaseAdmin
    .from("sensitive_words")
    .select("id, word, category, action, enabled, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1)
  if (category) query = query.eq("category", category)
  if (q) query = query.ilike("word", `%${q}%`)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 各分类总数（前端展示分布；与当前过滤无关，单独查一次轻量聚合）
  const { data: dist } = await supabaseAdmin.from("sensitive_words").select("category")
  const byCategory: Record<string, number> = {}
  for (const r of dist ?? []) {
    const c = (r as any).category || "未分类"
    byCategory[c] = (byCategory[c] || 0) + 1
  }

  return NextResponse.json({ words: data ?? [], total: count ?? 0, byCategory })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  const body = await req.json().catch(() => ({}))
  const word = String(body.word ?? "").trim()
  const category = CATEGORIES.includes(body.category) ? body.category : "政治"
  const action = body.action === "flag" ? "flag" : "block"
  if (!word) return NextResponse.json({ error: "词不能为空" }, { status: 400 })
  if (word.length > 60) return NextResponse.json({ error: "词过长" }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from("sensitive_words")
    .insert({ word, category, action })
    .select("id, word, category, action, enabled, created_at")
    .single()
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "该词已存在" }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ word: data })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  const body = await req.json().catch(() => ({}))
  const id = body.id
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 })

  const patch: Record<string, any> = {}
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled
  if (body.action === "block" || body.action === "flag") patch.action = body.action
  if (CATEGORIES.includes(body.category)) patch.category = body.category
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "无可更新字段" }, { status: 400 })

  const { error } = await supabaseAdmin.from("sensitive_words").update(patch).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 })
  const { error } = await supabaseAdmin.from("sensitive_words").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
