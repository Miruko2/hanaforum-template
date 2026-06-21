"use client"

import { useEffect } from "react"
import { Capacitor } from "@capacitor/core"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { supabase } from "@/lib/supabaseClient"

// App 存活时把实时收到的私信 / 站内通知弹成「手机系统通知」（安卓本地通知，不依赖谷歌/厂商）。
//
// 【调试版·2026-06-21】系统通知一直不弹（App 内通知正常），原生链路隐形看不到。
// 本版在 notify() 每步打 alert（最多 3 次），把"插件/权限/建渠道/schedule"的结果暴露出来，
// 收到私信时弹框显示，便于定位卡点。定位后会移除这些 alert。
// Web 端整段 no-op。

const LOCAL_NOTIF_ENABLED = true

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

// 临时可见调试：把隐形的原生链路结果用弹框显示出来（最多 3 次，避免刷屏）
let dbgCount = 0
function dbg(msg: string) {
  try {
    if (dbgCount < 3) {
      dbgCount++
      window.alert("[通知调试] " + msg)
    }
  } catch {
    /* ignore */
  }
}

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

async function notify(title: string, body: string, url: string) {
  const steps: string[] = []
  try {
    const LN = await getLN()
    steps.push(LN ? "plugin=OK" : "plugin=NULL")
    if (!LN) {
      dbg(steps.join(" | "))
      return
    }

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
        steps.push("perm=" + (p?.display ?? "?"))
        if (p?.display !== "granted") {
          const r = await LN.requestPermissions()
          steps.push("req=" + (r?.display ?? "?"))
        }
      } catch (e: any) {
        steps.push("permERR=" + (e?.message ?? e))
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
        steps.push("channel=OK")
      } catch (e: any) {
        channelReady = false
        steps.push("channelERR=" + (e?.message ?? e))
      }
    }

    notifId = (notifId + 1) & 0x7fffffff
    const n: any = { id: notifId, title, body: body || "", extra: { url } }
    if (channelReady) n.channelId = "messages"
    await LN.schedule({ notifications: [n] })
    steps.push("schedule=OK")
    dbg(steps.join(" | "))
  } catch (e: any) {
    steps.push("scheduleERR=" + (e?.message ?? e))
    dbg(steps.join(" | "))
  }
}

export default function LocalNotifier() {
  const { user } = useSimpleAuth()

  useEffect(() => {
    if (!LOCAL_NOTIF_ENABLED) return
    if (!isNative() || !user?.id) return
    const myId = user.id

    const dmCh = supabase
      .channel(`ln-dm-${myId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_messages", filter: `recipient_id=eq.${myId}` },
        async (payload) => {
          const r = payload.new as { sender_id?: string; kind?: string; content?: string }
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
      .subscribe()

    const ntCh = supabase
      .channel(`ln-nt-${myId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${myId}` },
        (payload) => {
          const r = payload.new as { type?: string; message?: string }
          if (!r) return
          notify(NOTIF_TITLES[r.type ?? ""] ?? "新通知", String(r.message ?? "你有一条新通知"), "/notifications")
        },
      )
      .subscribe()

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

  return null
}
