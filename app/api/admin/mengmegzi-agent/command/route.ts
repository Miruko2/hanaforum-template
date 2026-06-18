// app/api/admin/mengmegzi-agent/command/route.ts
//
// 指令端点（admin）：单发指令（异步写 pending_task）+ 轮询开关。

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { loadState, setPendingTask, type PendingTask } from "@/lib/mengmegzi/state"
import { ALL_CATEGORIES } from "@/lib/mengmegzi/constants"
import type { CategoryValue } from "@/lib/categories"
import { isValidCategory } from "@/lib/categories"

export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const token = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.slice(7).trim()
    : ""
  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 })
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !auth?.user) return NextResponse.json({ error: "认证失败" }, { status: 401 })
  const { data: adminRow } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle()
  if (!adminRow) return NextResponse.json({ error: "无权限" }, { status: 403 })
  return null
}

function pickRandomCategory(): CategoryValue {
  return ALL_CATEGORIES[Math.floor(Math.random() * ALL_CATEGORIES.length)] as CategoryValue
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as {
    action: string
    post_id?: string
    comment_id?: string
    category?: string
  }

  // 轮询开关：直接改 config
  if (body.action === "start_comment_polling" || body.action === "stop_comment_polling") {
    const enabled = body.action === "start_comment_polling"
    const { error } = await supabaseAdmin
      .from("mengmegzi_config")
      .update({ comment_polling_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("id", 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, polling: enabled })
  }

  // 单发指令：写 pending_task
  const state = await loadState()
  if (!state) return NextResponse.json({ error: "状态表未初始化" }, { status: 500 })
  if (state.status === "dead") {
    return NextResponse.json({ error: "当前死机，请先重置" }, { status: 409 })
  }
  if (state.pending_task) {
    return NextResponse.json({ error: "已有待办任务在排队" }, { status: 409 })
  }

  let task: PendingTask
  if (body.action === "post_now") {
    const cat =
      body.category && isValidCategory(body.category)
        ? (body.category as CategoryValue)
        : pickRandomCategory()
    task = { type: "post", category: cat, queued_at: new Date().toISOString() }
  } else if (body.action === "comment_now") {
    if (!body.post_id) return NextResponse.json({ error: "缺 post_id" }, { status: 400 })
    task = { type: "comment", target_post_id: body.post_id, queued_at: new Date().toISOString() }
  } else if (body.action === "reply_now") {
    if (!body.comment_id) return NextResponse.json({ error: "缺 comment_id" }, { status: 400 })
    task = {
      type: "reply",
      target_comment_id: body.comment_id,
      queued_at: new Date().toISOString(),
    }
  } else {
    return NextResponse.json({ error: "未知 action" }, { status: 400 })
  }

  await setPendingTask(task)
  return NextResponse.json({ ok: true, accepted: true }, { status: 202 })
}
