// lib/mengmegzi/state.ts
//
// 状态机读写 + pending_task 管理 + 日志写入。
// 纯靠 DB busy 标志做并发保护（serverless 多实例共享），不用内存限流器。

import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type AgentStatus = "idle" | "busy" | "dead"

export interface PendingTask {
  type: "post" | "comment" | "reply"
  target_post_id?: string
  target_comment_id?: string
  category?: string
  queued_at: string
}

export interface AgentState {
  status: AgentStatus
  current_task: string
  last_error: string
  last_action_at: string | null
  last_error_at: string | null
  busy_since: string | null
  pending_task: PendingTask | null
  /** 上次自动发帖时间（定时发帖轮询独立计时，与 last_action_at 解耦） */
  last_post_at: string | null
}

export interface AgentConfig {
  comment_polling_enabled: boolean
  comment_interval_min: number
  comment_scan_hours: number
  busy_timeout_min: number
  image_sources: Record<string, any>
  /** 定时自动发帖：开关 / 间隔（分钟）/ 分类（''=随机） */
  post_polling_enabled: boolean
  post_interval_min: number
  post_category: string
}

export async function loadState(): Promise<AgentState | null> {
  const { data } = await supabaseAdmin
    .from("mengmegzi_agent_state")
    .select(
      "status, current_task, last_error, last_action_at, last_error_at, busy_since, pending_task, last_post_at",
    )
    .eq("id", 1)
    .maybeSingle()
  return (data as AgentState) || null
}

export async function loadConfig(): Promise<AgentConfig | null> {
  const { data } = await supabaseAdmin
    .from("mengmegzi_config")
    .select(
      "comment_polling_enabled, comment_interval_min, comment_scan_hours, busy_timeout_min, image_sources, post_polling_enabled, post_interval_min, post_category",
    )
    .eq("id", 1)
    .maybeSingle()
  return (data as AgentConfig) || null
}

/** 进入 busy：status=busy, busy_since=now, current_task=描述 */
export async function markBusy(currentTask: string): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({
      status: "busy",
      current_task: currentTask,
      busy_since: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
}

/** 成功完成：status=idle, 清 current_task, 更新 last_action_at */
export async function markIdle(): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({
      status: "idle",
      current_task: "",
      busy_since: null,
      last_action_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
}

/** 死机：status=dead, last_error, last_error_at */
export async function markDead(error: string): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({
      status: "dead",
      current_task: "",
      busy_since: null,
      last_error: error,
      last_error_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
}

/** 重置：dead → idle，清错误和 pending_task（面板"重置"按钮用） */
export async function resetState(): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({
      status: "idle",
      current_task: "",
      last_error: "",
      busy_since: null,
      pending_task: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
}

/** 写 pending_task（单发指令用，不改 status） */
export async function setPendingTask(task: PendingTask): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({ pending_task: task, updated_at: new Date().toISOString() })
    .eq("id", 1)
}

/** 清 pending_task（执行完后） */
export async function clearPendingTask(): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({ pending_task: null, updated_at: new Date().toISOString() })
    .eq("id", 1)
}

/** 记录本次定时发帖时间（发帖轮询独立计时，与 last_action_at 解耦） */
export async function setLastPostAt(): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({ last_post_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", 1)
}

/** 写日志 */
export async function logAction(
  actionType: "post" | "comment" | "reply",
  targetId: string | null,
  result: "success" | "error",
  detail: string,
): Promise<void> {
  await supabaseAdmin.from("mengmegzi_action_log").insert({
    action_type: actionType,
    target_id: targetId,
    result,
    detail,
  })
}
