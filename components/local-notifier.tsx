"use client"

import { useEffect, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { supabase } from "@/lib/supabaseClient"

// 【调试版2·2026-06-21·ln-dbg2】系统通知不弹，且 alert 没出现。改用「屏幕底部常驻浮层」
// 显示：版本号 + 订阅状态 + 收到的事件 + notify 每步结果。比 alert 可靠（不被 ROM 拦）。
// 看到底部绿色调试条=新代码已生效；据条里内容定位卡点。定位后整段移除。Web 端不显示。

const LOCAL_NOTIF_ENABLED = true
const DEBUG_OVERLAY = true
const VERSION = "ln-dbg2"

const NOTIF_TITLES: Record<string, string> = {
  chat_mention: "有人提到了你",
  like_post: "新的点赞",
  comment_post: "新的评论",
  like_comment: "新的点赞",
  follow: "新的关注",
  friend_link_apply: "友链申请",
  moderation: "内容审核",
}

let notifId = 1
const nameCache = new Map<string, string>()
let pluginPromise: Promise<any> | null = null
let permRequested = false
let listenerAdded = false
let channelReady = false

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

async function getLN(): Promise<any | null> {
  if (!pluginPromise) {
    pluginPromise = import("@capacitor/local-notifications")
      .then((m) => m.LocalNotifications)
      .catch(() => null)
  }
  return pluginPromise
}

export default function LocalNotifier() {
  const { user } = useSimpleAuth()
  const [log, setLog] = useState<string[]>([])

  useEffect(() => {
    if (!LOCAL_NOTIF_ENABLED) return
    if (!isNative() || !user?.id) return
    const myId = user.id
    const push = (s: string) => setLog((l) => [...l, s].slice(-9))
    push(`mounted uid=${myId.slice(0, 6)}`)

    const notify = async (title: string, body: string, url: string) => {
      try {
        const LN = await getLN()
        push(LN ? "plugin=OK" : "plugin=NULL")
        if (!LN) return
        if (!listenerAdded) {
          listenerAdded = true
          try {
            await LN.addListener("localNotificationActionPerformed", (a: any) => {
              const u = a?.notification?.extra?.url
              if (u && typeof u === "string") {
                try {
                  window.location.assign(u)
                } catch {
                  /* ignore */
                }
              }
            })
          } catch {
            /* ignore */
          }
        }
        if (!permRequested) {
          permRequested = true
          try {
            const p = await LN.checkPermissions()
            push("perm=" + (p?.display ?? "?"))
            if (p?.display !== "granted") {
              const r = await LN.requestPermissions()
              push("req=" + (r?.display ?? "?"))
            }
          } catch (e: any) {
            push("permERR=" + (e?.message ?? e))
          }
        }
        if (!channelReady) {
          try {
            await LN.createChannel({
              id: "messages",
              name: "消息通知",
              description: "私信与站内通知",
              importance: 5,
              visibility: 1,
            })
            channelReady = true
            push("channel=OK")
          } catch (e: any) {
            push("channelERR=" + (e?.message ?? e))
          }
        }
        notifId = (notifId + 1) & 0x7fffffff
        const n: any = { id: notifId, title, body: body || "", extra: { url } }
        if (channelReady) n.channelId = "messages"
        await LN.schedule({ notifications: [n] })
        push("schedule=OK ✅")
      } catch (e: any) {
        push("scheduleERR=" + (e?.message ?? e))
      }
    }

    const dmCh = supabase
      .channel(`ln-dm-${myId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_messages", filter: `recipient_id=eq.${myId}` },
        async (payload) => {
          const r = payload.new as { sender_id?: string; kind?: string; content?: string }
          push("dm事件 from=" + String(r?.sender_id ?? "").slice(0, 6))
          if (!r || r.sender_id === myId) return
          let name = (r.sender_id && nameCache.get(r.sender_id)) || ""
          if (!name && r.sender_id) {
            try {
              const { data } = await supabase
                .from("profiles")
                .select("username")
                .eq("id", r.sender_id)
                .maybeSingle()
              if (data?.username) {
                name = String(data.username)
                nameCache.set(r.sender_id, name)
              }
            } catch {
              /* ignore */
            }
          }
          const body = r.kind === "sticker" ? "[贴纸]" : String(r.content ?? "")
          notify(name || "新私信", body || "发来一条消息", "/chat")
        },
      )
      .subscribe((status) => push("dm订阅:" + status))

    const ntCh = supabase
      .channel(`ln-nt-${myId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${myId}` },
        (payload) => {
          const r = payload.new as { type?: string; message?: string }
          push("通知事件 type=" + (r?.type ?? "?"))
          if (!r) return
          notify(NOTIF_TITLES[r.type ?? ""] ?? "新通知", String(r.message ?? "你有一条新通知"), "/notifications")
        },
      )
      .subscribe((status) => push("通知订阅:" + status))

    return () => {
      try {
        supabase.removeChannel(dmCh)
      } catch {
        /* ignore */
      }
      try {
        supabase.removeChannel(ntCh)
      } catch {
        /* ignore */
      }
    }
  }, [user?.id])

  if (!DEBUG_OVERLAY || !isNative()) return null
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2147483647,
        background: "rgba(0,0,0,0.82)",
        color: "#A3E635",
        font: "11px/1.45 monospace",
        padding: "6px 8px",
        maxHeight: "42vh",
        overflow: "auto",
        pointerEvents: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {`[LN调试 ${VERSION}]\n` + (log.length ? log.join("\n") : "(等待…发条私信看看)")}
    </div>
  )
}
