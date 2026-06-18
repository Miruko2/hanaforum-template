// hooks/use-mengmegzi-command.ts
//
// 管理员在论坛前端一键派发萌萌子指令（发帖/留言/回复）。
// 走 /api/admin/mengmegzi-agent/command，带 Bearer token。
// 仅管理员按钮会调用本 hook——非管理员不会渲染按钮，故此处不重复鉴权判断。

import { useState, useCallback } from "react"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"

export function useMengmegziCommand() {
  const [sending, setSending] = useState(false)

  const send = useCallback(async (body: {
    action: "post_now" | "comment_now" | "reply_now"
    post_id?: string
    comment_id?: string
  }): Promise<{ ok: boolean; message: string }> => {
    setSending(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) return { ok: false, message: "未登录" }

      const res = await fetch(apiUrl("/api/admin/mengmegzi-agent/command"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) return { ok: false, message: data.error || "指令失败" }
      return { ok: true, message: "已受理，等待萌萌子执行" }
    } catch (e: any) {
      return { ok: false, message: e?.message || "网络错误" }
    } finally {
      setSending(false)
    }
  }, [])

  return { sending, send }
}
