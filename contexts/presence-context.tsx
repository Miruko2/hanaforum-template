"use client"

// 全局在线状态（presence）。
//
// 由 floating-chat 原有的「面板打开才发心跳」逻辑提升而来：现在登录后浏览全站期间
// 始终维持心跳，「在线」=「登录且在用站」。这样私聊窗口里对方只要在用站就显示在线，
// 不会因为没打开聊天面板而被误判离线。
//
// 技术约束（调研确认）：
//   - 不能用 Supabase 原生 Presence（.track()/.presenceState()）：本项目 Realtime
//     不下发 presence_state 初始快照，presenceState() 恒为空（见 live-wall-content.tsx
//     注释）。故沿用广播心跳模式。
//   - 频道名保持 chat_room_online（与原逻辑兼容，全局共享一个频道）。
//   - 心跳 10s / 清理 3s / 超时 30s，参数与原逻辑一致。
//
// 在线状态纯客户端、不持久：关掉所有标签页即离线（≤30s 生效）；崩溃靠 30s 超时自愈。
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { supabase } from "@/lib/supabaseClient"

export interface OnlineUser {
  id: string
  username: string
  avatar_url?: string | null
}

type PresenceValue = {
  onlineUsers: OnlineUser[]
  isOnline: (id: string) => boolean
}

const PresenceContext = createContext<PresenceValue | null>(null)

const CHANNEL = "chat_room_online"
const HEARTBEAT_MS = 10_000
const PRUNE_MS = 3_000
const OFFLINE_TIMEOUT_MS = 30_000

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useSimpleAuth()
  const myId = user?.id
  const myName =
    user?.user_metadata?.username || (user?.email ? user.email.split("@")[0] : "匿名")

  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  // 自己的头像快照（心跳带上）；登入后从 profiles 拉一次
  const avatarRef = useRef<string | null>(null)

  useEffect(() => {
    if (!user?.id) return
    let alive = true
    supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (alive) avatarRef.current = data?.avatar_url ?? null
      })
    return () => {
      alive = false
    }
  }, [user?.id])

  // 心跳：登录即跑（不再依赖聊天面板开关）。channel config broadcast.self=true
  // 让自己的心跳回声也收到，多标签下互相刷新 ts。
  useEffect(() => {
    if (!myId) return

    const seen = new Map<string, { username: string; avatar_url: string | null; ts: number }>()
    const refresh = () => {
      const now = Date.now()
      for (const [id, v] of seen) if (now - v.ts > OFFLINE_TIMEOUT_MS) seen.delete(id)
      setOnlineUsers(
        Array.from(seen, ([id, v]) => ({ id, username: v.username, avatar_url: v.avatar_url })),
      )
    }
    seen.set(myId, { username: myName, avatar_url: avatarRef.current, ts: Date.now() })
    setOnlineUsers([{ id: myId, username: myName, avatar_url: avatarRef.current }])

    const presence = supabase.channel(CHANNEL, { config: { broadcast: { self: true } } })
    const beat = () =>
      presence.send({
        type: "broadcast",
        event: "hb",
        payload: { id: myId, username: myName, avatar_url: avatarRef.current },
      })
    presence
      .on("broadcast", { event: "hb" }, ({ payload }) => {
        if (payload?.id) {
          seen.set(payload.id, {
            username: payload.username || "匿名",
            avatar_url: payload.avatar_url ?? null,
            ts: Date.now(),
          })
          refresh()
        }
      })
      .on("broadcast", { event: "bye" }, ({ payload }) => {
        if (payload?.id && seen.delete(payload.id)) refresh()
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") beat()
      })

    const beatTimer = setInterval(beat, HEARTBEAT_MS)
    const pruneTimer = setInterval(refresh, PRUNE_MS)

    return () => {
      presence.send({ type: "broadcast", event: "bye", payload: { id: myId } })
      supabase.removeChannel(presence)
      clearInterval(beatTimer)
      clearInterval(pruneTimer)
    }
  }, [myId, myName])

  // 登出：清空在线列表
  useEffect(() => {
    if (!myId) setOnlineUsers([])
  }, [myId])

  const isOnline = useCallback(
    (id: string) => onlineUsers.some((u) => u.id === id),
    [onlineUsers],
  )

  return (
    <PresenceContext.Provider value={{ onlineUsers, isOnline }}>
      {children}
    </PresenceContext.Provider>
  )
}

export function usePresence(): PresenceValue {
  const ctx = useContext(PresenceContext)
  if (!ctx) {
    // 容错：无 Provider 时返回空实现，组件不崩
    return { onlineUsers: [], isOnline: () => false }
  }
  return ctx
}
