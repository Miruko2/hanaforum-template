"use client"

import { useEffect, useState } from "react"
import { Capacitor } from "@capacitor/core"
// 静态 import：插件打进主包随 App 一起加载，不再单独联网拉分块（动态 import 在弱网+VPN 下会卡死）。
import { LocalNotifications } from "@capacitor/local-notifications"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { supabase } from "@/lib/supabaseClient"

// 【调试版3·2026-06-21·ln-dbg3】上一版定位到：订阅成功、dm事件已到，但 notify 卡在
// 「await import(插件)」动态分块加载（弱网 29.8KB/s + VPN 拉不下来）。本版改静态 import +
// 查名字改后台不阻塞，并保留底部调试浮层确认链路打通（schedule=OK + 真弹通知）。
// Web 端不显示浮层、不调原生。

const LOCAL_NOTIF_ENABLED = true
const DEBUG_OVERLAY = true
const VERSION = "ln-dbg3"

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
      push("notify进入")
      try {
        const LN = LocalNotifications
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
        (payload) => {
          const r = payload.new as { sender_id?: string; kind?: string; content?: string }
          push("dm事件 from=" + String(r?.sender_id ?? "").slice(0, 6))
          if (!r || r.sender_id === myId) return
          const sid = r.sender_id
          const name = (sid && nameCache.get(sid)) || ""
          // 后台补名字进缓存（fire-and-forget，绝不阻塞通知）
          if (!name && sid) {
            void (async () => {
              try {
                const { data } = await supabase
                  .from("profiles")
                  .select("username")
                  .eq("id", sid)
                  .maybeSingle()
                if (data?.username) nameCache.set(sid, String(data.username))
              } catch {
                /* ignore */
              }
            })()
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
