"use client"

import { useEffect } from "react"
import { Capacitor } from "@capacitor/core"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { supabase } from "@/lib/supabaseClient"

// App 存活时把实时收到的私信 / 站内通知弹成「手机系统通知」（安卓本地通知，不依赖谷歌/厂商）。
//
// 【保守版·2026-06-21】上一版在「已登录冷启动」时于挂载阶段就调原生（checkPermissions/
// requestPermissions/createChannel），在某些设备/ROM 上直接原生崩溃 → 一打开就闪退。
// 本版策略：
//   - 挂载/开机阶段「一个原生调用都不碰」，只建 realtime 订阅（纯 JS，绝不崩）；
//   - 所有原生操作（插件加载 / 权限 / 弹通知）全部推迟到「真的来消息时」才执行 ——
//     那时 App 已完全可交互、Capacitor 桥/Activity 就绪，最危险的冷启动窗口已过；
//   - createChannel（高重要性渠道→顶部横幅）改到「收到消息时」才建：实测收消息时其它原生
//     调用都不崩，说明原崩点是冷启动时机而非调用本身，故此刻建渠道安全；建失败则降级默认渠道；
//   - 即使仍有问题，也只会在「收到消息时」出问题、而非一打开就崩（不会再陷入开机崩溃循环）。
// Web 端整段 no-op。
//
// 局限不变：仅 App 进程存活时有效；被系统杀掉后不触发。

// 临时总开关：万一保守版仍在「收到消息时」崩，把它改回 false 重新部署即可一键停用（不必重打 APK）。
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

// 懒加载单例：插件、权限、点击监听都只初始化一次，且都在「首条消息到来时」才触发。
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

// 真正弹一条系统通知 —— 仅在「收到消息」时被调用（App 此刻已完全就绪）。
async function notify(title: string, body: string, url: string) {
  const LN = await getLN()
  if (!LN) return
  try {
    // 点击通知跳转监听（只装一次）
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
    // 通知权限：只主动申请一次；失败/被拒也不抛，schedule 弹不出来也不崩
    if (!permRequested) {
      permRequested = true
      try {
        const p = await LN.checkPermissions()
        if (p?.display !== "granted") {
          await LN.requestPermissions()
        }
      } catch {
        /* ignore */
      }
    }
    // 高重要性渠道 → 顶部横幅。只在此刻（收到消息时）建一次，避开冷启动崩溃窗口；
    // 建失败则降级用插件默认渠道（仍会进通知栏，只是可能不弹横幅）。
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
      } catch {
        channelReady = false
      }
    }
    notifId = (notifId + 1) & 0x7fffffff
    // 小图标走 capacitor.config 的 smallIcon（ic_stat_notify）
    const n: any = { id: notifId, title, body: body || "", extra: { url } }
    if (channelReady) n.channelId = "messages"
    await LN.schedule({ notifications: [n] })
  } catch (e) {
    console.warn("[local-notif] 弹通知失败", e)
  }
}

export default function LocalNotifier() {
  const { user } = useSimpleAuth()

  useEffect(() => {
    if (!LOCAL_NOTIF_ENABLED) return
    if (!isNative() || !user?.id) return
    const myId = user.id

    // 私信：别人发给我的 → 弹系统通知（原生调用都在 notify() 里、延后到此刻才发生）
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

    // 站内通知：发给我的新通知 → 弹系统通知
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
