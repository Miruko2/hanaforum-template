// components/admin/mengmegzi-agent-panel.tsx
"use client"

// 萌萌子 Agent 面板：状态卡 + 指令卡 + 配置卡 + 日志卡。
// 全部用站内 profile-glass 毛玻璃风格（与个人中心等面板统一语言），不用 shadcn Card。
// 复用现有 admin 的 getSession + apiUrl + Bearer token 模式。

import { useEffect, useState, useCallback } from "react"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/categories"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { RefreshCw, Send, MessageSquare, Reply, Power } from "lucide-react"

type Status = "idle" | "busy" | "dead"

interface StateData {
  status: Status
  current_task: string
  last_error: string
  last_action_at: string | null
  last_error_at: string | null
  pending_task: any
}

interface ConfigData {
  comment_polling_enabled: boolean
  comment_interval_min: number
  comment_scan_hours: number
  busy_timeout_min: number
}

interface LogRow {
  id: number
  action_type: string
  target_id: string | null
  result: string
  detail: string
  created_at: string
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** 分类选择 chip 样式（选中=lime 实心，未选=毛玻璃描边） */
function chipCls(active: boolean): string {
  return `px-2.5 py-1 rounded-full text-xs border transition-colors ${
    active
      ? "bg-lime-500/90 text-black border-lime-400"
      : "bg-white/5 text-white/80 border-white/15 hover:bg-white/10"
  }`
}

const STATUS_LABEL: Record<Status, string> = { idle: "休息中", busy: "行动中", dead: "死机" }
const STATUS_DOT: Record<Status, string> = {
  idle: "bg-gray-400",
  busy: "bg-green-400 animate-pulse",
  dead: "bg-red-500",
}

export default function MengmegziAgentPanel() {
  const [state, setState] = useState<StateData | null>(null)
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [logs, setLogs] = useState<LogRow[]>([])
  const [postCategory, setPostCategory] = useState<string>("") // "" = 随机
  const [postId, setPostId] = useState("")
  const [commentId, setCommentId] = useState("")
  const [sending, setSending] = useState(false)

  const refreshAll = useCallback(async () => {
    const h = await authHeaders()
    const [s, c, l] = await Promise.all([
      fetch(apiUrl("/api/admin/mengmegzi-agent/state"), { headers: h }).then((r) => r.json()),
      fetch(apiUrl("/api/admin/mengmegzi-agent/config"), { headers: h }).then((r) => r.json()),
      fetch(apiUrl("/api/admin/mengmegzi-agent/log?limit=50"), { headers: h }).then((r) =>
        r.json(),
      ),
    ])
    setState(s)
    setConfig(c)
    setLogs(Array.isArray(l) ? l : [])
  }, [])

  useEffect(() => {
    refreshAll()
    const t = setInterval(refreshAll, 10000)
    return () => clearInterval(t)
  }, [refreshAll])

  async function sendCommand(body: any) {
    setSending(true)
    try {
      const res = await fetch(apiUrl("/api/admin/mengmegzi-agent/command"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) alert(data.error || "指令失败")
      else alert("已受理，等待 tick 执行")
      await refreshAll()
    } finally {
      setSending(false)
    }
  }

  async function resetState() {
    await fetch(apiUrl("/api/admin/mengmegzi-agent/state"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ action: "reset" }),
    })
    await refreshAll()
  }

  async function saveConfig() {
    if (!config) return
    await fetch(apiUrl("/api/admin/mengmegzi-agent/config"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(config),
    })
    alert("配置已保存")
  }

  const disabled = state?.status === "dead"

  return (
    <div className="space-y-4">
      {/* 状态卡 */}
      <section className="profile-glass rounded-2xl p-5 text-white">
        <div className="flex items-center gap-3 mb-3">
          <span
            className={`inline-block h-3 w-3 rounded-full ${
              state ? STATUS_DOT[state.status] : "bg-gray-400"
            }`}
          />
          <span className="text-lg font-semibold tracking-wide">
            {state ? STATUS_LABEL[state.status] : "加载中..."}
            {config?.comment_polling_enabled && state?.status === "idle" && (
              <span className="ml-2 text-sm text-purple-300">·自动中</span>
            )}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            {state?.status === "dead" && (
              <Button variant="destructive" size="sm" onClick={resetState}>
                重置
              </Button>
            )}
          </div>
        </div>
        <div className="space-y-1 text-sm text-white/70">
          {state?.current_task && <div>当前任务：{state.current_task}</div>}
          {state?.last_action_at && (
            <div>上次行动：{new Date(state.last_action_at).toLocaleString()}</div>
          )}
          {state?.status === "dead" && state.last_error && (
            <div className="text-red-400">最近错误：{state.last_error}</div>
          )}
          {state?.pending_task && (
            <div className="text-lime-300">
              待办：{state.pending_task.type}
              {state.pending_task.category ? ` (${state.pending_task.category})` : ""}
            </div>
          )}
        </div>
      </section>

      {/* 指令卡 */}
      <section className="profile-glass rounded-2xl p-5 text-white">
        <h3 className="text-base font-semibold tracking-wide mb-4">指令</h3>
        <div className="space-y-3">
          {/* 发帖：先选分类（不选=随机），再发。后端 post_now 收到 category 就用、否则随机。 */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm text-white/60 mr-1">分类：</span>
              <button
                type="button"
                onClick={() => setPostCategory("")}
                className={chipCls(postCategory === "")}
              >
                随机
              </button>
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setPostCategory(c.value)}
                  className={chipCls(postCategory === c.value)}
                >
                  <span className="opacity-70 mr-0.5">{c.glyph}</span>
                  {c.label}
                </button>
              ))}
            </div>
            <Button
              disabled={disabled || sending}
              onClick={() =>
                sendCommand({
                  action: "post_now",
                  ...(postCategory ? { category: postCategory } : {}),
                })
              }
              className="bg-lime-500/90 text-black hover:bg-lime-400"
            >
              <Send className="h-4 w-4 mr-1" />
              发一帖（{postCategory ? CATEGORY_LABELS[postCategory] : "随机"}）
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="帖子 ID"
              value={postId}
              onChange={(e) => setPostId(e.target.value)}
              disabled={disabled}
              className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus:border-lime-400/50"
            />
            <Button
              disabled={disabled || sending || !postId}
              onClick={() => sendCommand({ action: "comment_now", post_id: postId })}
              className="bg-white/10 text-white border border-white/15 hover:bg-white/20"
            >
              <MessageSquare className="h-4 w-4 mr-1" />
              给该帖留言
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="评论 ID"
              value={commentId}
              onChange={(e) => setCommentId(e.target.value)}
              disabled={disabled}
              className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus:border-lime-400/50"
            />
            <Button
              disabled={disabled || sending || !commentId}
              onClick={() => sendCommand({ action: "reply_now", comment_id: commentId })}
              className="bg-white/10 text-white border border-white/15 hover:bg-white/20"
            >
              <Reply className="h-4 w-4 mr-1" />
              回复该评论
            </Button>
          </div>
          <div className="flex items-center gap-2 pt-3 border-t border-white/10">
            <Power className="h-4 w-4 text-white/70" />
            <span className="text-sm text-white/80">留言+回复轮询</span>
            <Switch
              checked={config?.comment_polling_enabled || false}
              onCheckedChange={(v) =>
                sendCommand({ action: v ? "start_comment_polling" : "stop_comment_polling" })
              }
              className="data-[state=checked]:bg-lime-500 data-[state=unchecked]:bg-white/20"
            />
            {config?.comment_polling_enabled && (
              <span className="text-xs text-purple-300">·自动中</span>
            )}
          </div>
        </div>
      </section>

      {/* 配置卡 */}
      <section className="profile-glass rounded-2xl p-5 text-white">
        <h3 className="text-base font-semibold tracking-wide mb-4">配置</h3>
        {config ? (
          <div className="space-y-3 text-sm">
            <label className="flex items-center gap-3 text-white/80">
              <span className="w-44">留言节奏（分钟）：</span>
              <Input
                type="number"
                value={config.comment_interval_min}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    comment_interval_min: parseInt(e.target.value, 10) || 30,
                  })
                }
                className="w-24 border-white/15 bg-white/5 text-white focus:border-lime-400/50"
              />
            </label>
            <label className="flex items-center gap-3 text-white/80">
              <span className="w-44">扫描最近多少小时新帖：</span>
              <Input
                type="number"
                value={config.comment_scan_hours}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    comment_scan_hours: parseInt(e.target.value, 10) || 24,
                  })
                }
                className="w-24 border-white/15 bg-white/5 text-white focus:border-lime-400/50"
              />
            </label>
            <label className="flex items-center gap-3 text-white/80">
              <span className="w-44">busy 超时（分钟）：</span>
              <Input
                type="number"
                value={config.busy_timeout_min}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    busy_timeout_min: parseInt(e.target.value, 10) || 5,
                  })
                }
                className="w-24 border-white/15 bg-white/5 text-white focus:border-lime-400/50"
              />
            </label>
            <Button
              onClick={saveConfig}
              className="bg-lime-500/90 text-black hover:bg-lime-400"
            >
              保存配置
            </Button>
          </div>
        ) : (
          <div className="text-white/50 text-sm">加载配置中...</div>
        )}
      </section>

      {/* 日志卡 */}
      <section className="profile-glass rounded-2xl p-5 text-white">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-base font-semibold tracking-wide">日志</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            className="ml-auto border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <div className="max-h-96 overflow-auto rounded-lg bg-black/20">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-black/30 backdrop-blur-sm">
              <tr className="text-left text-white/60">
                <th className="py-2 px-3 font-medium">时间</th>
                <th className="px-2 font-medium">类型</th>
                <th className="px-2 font-medium">结果</th>
                <th className="px-2 font-medium">详情</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-white/5">
                  <td className="py-1.5 px-3 text-white/60 whitespace-nowrap">
                    {new Date(l.created_at).toLocaleString()}
                  </td>
                  <td className="px-2 text-white/80">{l.action_type}</td>
                  <td className={`px-2 ${l.result === "success" ? "text-lime-400" : "text-red-400"}`}>
                    {l.result}
                  </td>
                  <td className="px-2 text-white/70 break-all">{l.detail}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-white/40">
                    暂无日志
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
