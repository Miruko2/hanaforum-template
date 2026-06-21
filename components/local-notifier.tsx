"use client"

import { useEffect } from "react"
import { Capacitor } from "@capacitor/core"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { supabase } from "@/lib/supabaseClient"

// App 存活（前台、或刚切后台还没被冻结）时，把实时收到的私信 / 站内通知
// 弹成「手机系统通知」。走安卓本地通知（NotificationManager），不依赖 Google 服务 /
// 厂商通道，国内全机型可用、不会崩。
// 局限：仅 App 进程存活时有效；被系统杀掉后不触发（那是 FCM/厂商推送范畴，已放弃）。
// Web 端整段 no-op（isNative() 为 false 时 effect 直接返回）。

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

function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

export default function LocalNotifier() {
  const { user } = useSimpleAuth()

  useEffect(() => {
    if (!isNative() || !user?.id) return
    const myId = user.id

    let LN: typeof import("@capacitor/local-notifications").LocalNotifications | null = null

    const fire = async (title: string, body: string, url: string) => {
      if (!LN) return
      try {
        notifId = (notifId + 1) & 0x7fffffff
        await LN.schedule({
          notifications: [
            { id: notifId, title, body: body || "", channelId: "messages", extra: { url } },
          ],
        })
      } catch (e) {
        console.warn("[local-notif] schedule 失败", e)
      }
    }

    const setup = async () => {
      let mod: typeof import("@capacitor/local-notifications")
      try {
        mod = await import("@capacitor/local-notifications")
      } catch {
        return // 插件未装（旧 APK）→ 静默跳过
      }
      LN = mod.LocalNotifications
      try {
        let perm = await LN.checkPermissions()
        if (perm.display === "prompt" || perm.display === "prompt-with-rationale") {
          perm = await LN.requestPermissions()
        }
        if (perm.display !== "granted") {
          LN = null
          return // 用户拒绝授权 → 不弹
        }
        // 高重要性渠道 → 顶部横幅 + 进通知栏
        await LN.createChannel({
          id: "messages",
          name: "消息通知",
          description: "私信与站内通知",
          importance: 5,
          visibility: 1,
        })
        // 点击系统通知 → 跳到对应页面
        await LN.addListener("localNotificationActionPerformed", (a) => {
          const url = a?.notification?.extra?.url
          if (url && typeof url === "string") {
            try {
              window.location.assign(url)
            } catch {
              /* ignore */
            }
          }
        })
      } catch (e) {
        console.warn("[local-notif] 初始化失败", e)
        LN = null
      }
    }
    setup()

    // 私信：别人发给我的新消息 → 弹系统通知
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
          fire(name || "新私信", body || "发来一条消息", "/chat")
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
          fire(NOTIF_TITLES[r.type ?? ""] ?? "新通知", String(r.message ?? "你有一条新通知"), "/notifications")
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
