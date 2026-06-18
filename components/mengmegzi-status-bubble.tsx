// components/mengmegzi-status-bubble.tsx
"use client"

// 萌萌子 Agent 状态悬浮泡：右下角全局可见，仅管理员能看到。
// 三态：休息中(灰)/行动中(绿脉动)/死机(红)。轮询开着时本体加紫色边框提示。
// 点一下展开卡片：看任务/错误 + 切轮询开关（不用进 admin 面板）。
// 轮询 /api/admin/mengmegzi-agent/state + /config，10s 一次。
// 放在 FAB 上方避免遮挡（FAB 在 bottom-6 right-6，本泡在 bottom-24 right-6）。

import { useEffect, useState, useCallback } from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { Bot, X, Zap } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { Switch } from "@/components/ui/switch"

type Status = "idle" | "busy" | "dead"

interface StateData {
  status: Status
  current_task: string
  last_error: string
  last_action_at: string | null
}

interface ConfigData {
  comment_polling_enabled: boolean
}

const STATUS_LABEL: Record<Status, string> = { idle: "休息中", busy: "行动中", dead: "死机" }
const STATUS_COLOR: Record<Status, string> = {
  idle: "bg-gray-400",
  busy: "bg-green-400",
  dead: "bg-red-500",
}

export default function MengmegziStatusBubble() {
  const { isAdmin } = useSimpleAuth()
  const [state, setState] = useState<StateData | null>(null)
  const [polling, setPolling] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [toggling, setToggling] = useState(false)

  const refresh = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData?.session?.access_token
    if (!token) return
    const h = { Authorization: `Bearer ${token}` }
    try {
      const [s, c] = await Promise.all([
        fetch(apiUrl("/api/admin/mengmegzi-agent/state"), { headers: h }).then((r) => r.json()),
        fetch(apiUrl("/api/admin/mengmegzi-agent/config"), { headers: h }).then((r) => r.json()),
      ])
      setState(s)
      setPolling(!!c?.comment_polling_enabled)
    } catch {
      /* 静默失败，不打扰用户 */
    }
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    refresh()
    const t = setInterval(refresh, 10000)
    return () => clearInterval(t)
  }, [isAdmin, refresh])

  // 切轮询开关：调 command 端点
  const togglePolling = useCallback(async (next: boolean) => {
    setToggling(true)
    setPolling(next) // 乐观更新
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) return
      const res = await fetch(apiUrl("/api/admin/mengmegzi-agent/command"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: next ? "start_comment_polling" : "stop_comment_polling",
        }),
      })
      if (!res.ok) setPolling(!next) // 失败回滚
    } catch {
      setPolling(!next)
    } finally {
      setToggling(false)
    }
  }, [])

  // 非管理员不渲染
  if (!isAdmin) return null

  const status: Status = state?.status || "idle"
  // 轮询开着时的视觉：紫色边框
  const ringClass = polling
    ? "border-purple-400/50 bg-purple-500/10"
    : status === "dead"
      ? "border-red-500/40 bg-red-500/10"
      : status === "busy"
        ? "border-green-400/40 bg-green-500/10"
        : "border-gray-400/30 bg-gray-500/10"

  return (
    <div className="fixed bottom-24 right-6 z-[998] flex flex-col items-end gap-2">
      {/* 展开卡片 */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="profile-glass w-64 rounded-2xl p-4 text-white"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Bot className="h-4 w-4 text-purple-300" />
                萌萌子
              </span>
              <button
                onClick={() => setExpanded(false)}
                className="text-white/50 hover:text-white"
                aria-label="收起"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* 轮询开关 */}
            <div className="mb-3 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs text-white/80">
                <Zap className="h-3.5 w-3.5 text-purple-300" />
                留言+回复轮询
              </span>
              <Switch
                checked={polling}
                onCheckedChange={togglePolling}
                disabled={toggling}
                className="data-[state=checked]:bg-lime-500 data-[state=unchecked]:bg-white/20"
              />
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${STATUS_COLOR[status]}`} />
                <span className="text-white/80">{STATUS_LABEL[status]}</span>
                {polling && status === "idle" && (
                  <span className="text-purple-300/70">·自动中</span>
                )}
              </div>
              {state?.current_task && (
                <div className="text-white/60">
                  <span className="text-white/40">任务：</span>
                  {state.current_task}
                </div>
              )}
              {status === "dead" && state?.last_error && (
                <div className="rounded bg-red-500/10 p-2 text-red-300">{state.last_error}</div>
              )}
              {state?.last_action_at && status !== "dead" && (
                <div className="text-white/40">
                  上次：{new Date(state.last_action_at).toLocaleTimeString()}
                </div>
              )}
              <a
                href="/admin"
                className="mt-2 block text-center text-purple-300 hover:text-purple-200"
              >
                打开管理面板 →
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 状态泡本体（点击展开） */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-md transition-all hover:scale-105 ${ringClass}`}
        title={`萌萌子：${STATUS_LABEL[status]}${polling ? "（轮询中）" : ""}`}
      >
        <span className="relative flex h-2.5 w-2.5">
          {status === "busy" && (
            <span
              className={`absolute inline-flex h-full w-full animate-ping rounded-full ${STATUS_COLOR[status]} opacity-75`}
            />
          )}
          <span
            className={`relative inline-flex h-2.5 w-2.5 rounded-full ${STATUS_COLOR[status]}`}
          />
        </span>
        <span className="flex items-center gap-1">
          <Bot className="h-3.5 w-3.5" />
          {STATUS_LABEL[status]}
          {polling && status === "idle" && (
            <Zap className="h-3 w-3 text-purple-300" />
          )}
        </span>
      </button>
    </div>
  )
}
