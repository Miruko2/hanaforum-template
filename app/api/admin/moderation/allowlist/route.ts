// 白名单（豁免词）管理：GET 列表 / POST 增 / PATCH 改启停 / DELETE 删。
import { NextRequest, NextResponse } from "next/server"
import { requireAdmin, supabaseAdmin } from "../guard"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  const { data, error } = await supabaseAdmin
    .from("moderation_allowlist")
    .select("id, phrase, note, enabled, created_at")
    .order("created_at", { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ allowlist: data ?? [] })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  const body = await req.json().catch(() => ({}))
  const phrase = String(body.phrase ?? "").trim()
  const note = body.note ? String(body.note).trim().slice(0, 200) : null
  if (!phrase) return NextResponse.json({ error: "豁免词不能为空" }, { status: 400 })
  if (phrase.length > 60) return NextResponse.json({ error: "豁免词过长" }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from("moderation_allowlist")
    .insert({ phrase, note })
    .select("id, phrase, note, enabled, created_at")
    .single()
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "该豁免词已存在" }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ item: data })
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  const body = await req.json().catch(() => ({}))
  const id = body.id
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 })
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "无可更新字段" }, { status: 400 })

  const { error } = await supabaseAdmin
    .from("moderation_allowlist")
    .update({ enabled: body.enabled })
    .eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 })
  const { error } = await supabaseAdmin.from("moderation_allowlist").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
