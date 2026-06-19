// app/api/mengmegzi-tick/route.ts
//
// CF Worker Cron 每 2 分钟戳一次。读状态决定执行单发任务或轮询。
// 走 cron 密钥校验（x-cron-secret），不走 admin 鉴权。

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  loadState,
  loadConfig,
  markBusy,
  markIdle,
  markDead,
  clearPendingTask,
  logAction,
} from "@/lib/mengmegzi/state"
import {
  executePost,
  executeComment,
  executeReply,
  findCommentablePost,
  findReplyableComment,
} from "@/lib/mengmegzi/executor"
import type { CategoryValue } from "@/lib/categories"
import { isValidCategory } from "@/lib/categories"
import type { PendingTask } from "@/lib/mengmegzi/state"

export const dynamic = "force-dynamic"
// Vercel 函数超时：tick 内同步跑 AI（可能数十秒）+ 图片管线，默认 10s 会被杀 → 卡 busy →
// busy_timeout 后判死机。60 是 Hobby 计划上限；若用推理模型且单次仍 >60s，需上 Pro 调到
// 300，或把重活挪到 CF Worker / Supabase Edge Function（执行预算更长）。
export const maxDuration = 60

// 查帖子标题用于 current_task 文案（查不到就回退短 id，绝不因查标题失败阻断执行）
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)
async function postTitle(postId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from("posts")
      .select("title")
      .eq("id", postId)
      .maybeSingle()
    return data?.title?.slice(0, 20) || postId.slice(0, 8)
  } catch {
    return postId.slice(0, 8)
  }
}

// 评论 id → 所属帖标题（回复任务的文案用）
async function postTitleForComment(commentId: string): Promise<string> {
  try {
    const { data: c } = await supabaseAdmin
      .from("comments")
      .select("post_id")
      .eq("id", commentId)
      .maybeSingle()
    if (!c?.post_id) return commentId.slice(0, 8)
    return await postTitle(c.post_id)
  } catch {
    return commentId.slice(0, 8)
  }
}

export async function POST(req: NextRequest) {
  // 1. 密钥校验
  const secret = req.headers.get("x-cron-secret")
  if (!secret || secret !== process.env.MENGMEGZI_CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    await runTick()
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[mengmegzi-tick] 异常:", e?.message || e)
    return NextResponse.json({ error: e?.message || "tick failed" }, { status: 500 })
  }
}

async function runTick(): Promise<void> {
  const state = await loadState()
  if (!state) return
  const cfg = await loadConfig()
  if (!cfg) return

  // 2. 死机不动
  if (state.status === "dead") return

  // 3. busy：判超时
  if (state.status === "busy") {
    if (state.busy_since) {
      const elapsed = Date.now() - new Date(state.busy_since).getTime()
      if (elapsed > cfg.busy_timeout_min * 60 * 1000) {
        await markDead(`执行超时(>${cfg.busy_timeout_min}min)`)
        await logAction("post", null, "error", `超时: busy_since=${state.busy_since}`)
      }
    }
    return
  }

  // 4. idle：先看 pending_task（单发优先）
  if (state.pending_task) {
    await runPendingTask(state.pending_task)
    return
  }

  // 5. 轮询
  if (!cfg.comment_polling_enabled) return
  const sinceMs = state.last_action_at ? new Date(state.last_action_at).getTime() : 0
  const elapsed = Date.now() - sinceMs
  if (elapsed < cfg.comment_interval_min * 60 * 1000) return

  // 回复优先 > 留言
  const replyTarget = await findReplyableComment()
  if (replyTarget) {
    // 回复对象是评论，查评论所属帖标题用于文案
    const title = await postTitleForComment(replyTarget)
    await runTask(
      `正在回复评论（${title}）`,
      () => executeReply(replyTarget),
      "reply",
      replyTarget,
    )
    return
  }
  const commentTarget = await findCommentablePost(cfg.comment_scan_hours)
  if (commentTarget) {
    const title = await postTitle(commentTarget)
    await runTask(
      `正在给帖子留言（${title}）`,
      () => executeComment(commentTarget),
      "comment",
      commentTarget,
    )
    return
  }
}

async function runPendingTask(task: PendingTask): Promise<void> {
  // 先清 pending_task，防执行中又来 tick 重复执行
  await clearPendingTask()
  if (task.type === "post") {
    const cat =
      task.category && isValidCategory(task.category)
        ? (task.category as CategoryValue)
        : undefined
    await runTask("正在发帖", () => executePost(cat), "post", null)
  } else if (task.type === "comment" && task.target_post_id) {
    const title = await postTitle(task.target_post_id)
    await runTask(
      `正在给帖子留言（${title}）`,
      () => executeComment(task.target_post_id!),
      "comment",
      task.target_post_id,
    )
  } else if (task.type === "reply" && task.target_comment_id) {
    const title = await postTitleForComment(task.target_comment_id)
    await runTask(
      `正在回复评论（${title}）`,
      () => executeReply(task.target_comment_id!),
      "reply",
      task.target_comment_id,
    )
  }
}

async function runTask(
  desc: string,
  fn: () => Promise<string>,
  logType: "post" | "comment" | "reply",
  targetId: string | null,
): Promise<void> {
  await markBusy(desc)
  try {
    await fn()
    await markIdle()
  } catch (e: any) {
    const msg = e?.message || String(e)
    await markDead(msg)
    await logAction(logType, targetId, "error", msg)
  }
}
