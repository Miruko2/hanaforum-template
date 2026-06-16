"use client"

// 全站在线状态（基于 Cloudflare Durable Object + WebSocket Hibernation）。
//
// 架构：客户端登录后连接 wss://presence.hanakos.cc/ws?token=<supabase-access-token>，
// CF Worker 校验 JWT 拿到 userId，路由到全局唯一 PresenceRoom DO。
// DO 用 Hibernation API 接管 WS（空闲不计 CPU 时间），内存维护 userId →
// Set<WebSocket>。客户端不发心跳——连接断开 = 离线。
//
// 服务端事件：
//   { type: "snapshot", users: [...] }   连上立即下发全量
//   { type: "online",  id }              某人上线
//   { type: "offline", id }              某人离线
//
// 客户端 → 服务端：
//   不需要发任何东西（连接存在 = 在线）
//
// 性能：客户端零定时器 / 零定时 setState；UI 重渲染仅在上下线事件触发。
//
// 兼容老接口：onlineUsers: OnlineUser[]（带 username/avatar_url），
// PresenceProvider 收到 userId 列表后批量查 profiles 补充（5min cache）。
//
// 降级（Kill Switch）：
//   - NEXT_PUBLIC_PRESENCE_WS_URL 未配置 → 静默降级（永远空）
//   - 连续 5 次重连失败 → 放弃，UI 自动隐藏在线指示器
//   - Worker 返回 503（kill switch / 软限流）→ 重连耗尽 5 次后放弃

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

const WS_URL = process.env.NEXT_PUBLIC_PRESENCE_WS_URL || ""
const MAX_RECONNECT_ATTEMPTS = 5
const PROFILE_CACHE_MS = 5 * 60_000

// 模块级 profile 缓存：跨 Provider 重挂保留（路由切换不重查）
const profileCache = new Map<string, { user: OnlineUser; ts: number }>()

async function resolveProfiles(ids: string[]): Promise<OnlineUser[]> {
  const now = Date.now()
  const hits: OnlineUser[] = []
  const need: string[] = []
  for (const id of ids) {
    const c = profileCache.get(id)
    if (c && now - c.ts < PROFILE_CACHE_MS) {
      hits.push(c.user)
    } else {
      need.push(id)
    }
  }
  if (need.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", need)
    const found = new Set<string>()
    if (data) {
      for (const p of data as Array<{ id: string; username: string | null; avatar_url: string | null }>) {
        const u: OnlineUser = {
          id: p.id,
          username: p.username || "匿名",
          avatar_url: p.avatar_url ?? null,
        }
        profileCache.set(p.id, { user: u, ts: now })
        hits.push(u)
        found.add(p.id)
      }
    }
    // 未查到的 id 也占位，避免反复打无效查询
    for (const id of need) {
      if (!found.has(id)) {
        const u: OnlineUser = { id, username: "匿名", avatar_url: null }
        profileCache.set(id, { user: u, ts: now })
        hits.push(u)
      }
    }
  }
  return hits
}

export function PresenceProvider({ children }: { children: ReactNode }) {
  const { user } = useSimpleAuth()
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const aliveRef = useRef(false)
  const killedRef = useRef(false)

  // onlineIds → onlineUsers（补充 username/avatar_url）
  useEffect(() => {
    let cancelled = false
    if (onlineIds.size === 0) {
      setOnlineUsers([])
      return
    }
    const ids = Array.from(onlineIds)
    resolveProfiles(ids).then((users) => {
      if (cancelled) return
      // 过滤：query 期间可能有人离线，按当前 onlineIds 过滤
      setOnlineUsers(users.filter((u) => onlineIds.has(u.id)))
    })
    return () => {
      cancelled = true
    }
  }, [onlineIds])

  // WS 连接生命周期
  useEffect(() => {
    if (!user?.id) {
      setOnlineIds(new Set())
      return
    }
    if (!WS_URL) {
      // 未配置 Worker URL → 静默降级
      return
    }

    aliveRef.current = true
    killedRef.current = false
    reconnectAttemptsRef.current = 0

    const scheduleReconnect = () => {
      if (!aliveRef.current || killedRef.current) return
      reconnectAttemptsRef.current += 1
      if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
        // Kill Switch：放弃，UI 永久降级到"离线状态"
        killedRef.current = true
        setOnlineIds(new Set())
        return
      }
      const delay = Math.min(30_000, 1000 * 2 ** (reconnectAttemptsRef.current - 1))
      reconnectTimerRef.current = setTimeout(connect, delay)
    }

    const connect = async () => {
      if (!aliveRef.current || killedRef.current) return

      // 拿 supabase access_token 作为 JWT
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        // session 还没就绪：3s 后重试（不计入 reconnect attempts）
        reconnectTimerRef.current = setTimeout(connect, 3000)
        return
      }

      let ws: WebSocket
      try {
        ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(session.access_token)}`)
      } catch {
        scheduleReconnect()
        return
      }
      wsRef.current = ws

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0
      }

      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === "snapshot" && Array.isArray(msg.users)) {
            setOnlineIds(new Set(msg.users.filter((x: unknown): x is string => typeof x === "string")))
          } else if (msg.type === "online" && typeof msg.id === "string") {
            setOnlineIds((prev) => {
              if (prev.has(msg.id)) return prev
              const next = new Set(prev)
              next.add(msg.id)
              return next
            })
          } else if (msg.type === "offline" && typeof msg.id === "string") {
            setOnlineIds((prev) => {
              if (!prev.has(msg.id)) return prev
              const next = new Set(prev)
              next.delete(msg.id)
              return next
            })
          }
        } catch {
          // 忽略坏帧
        }
      }

      ws.onclose = () => {
        wsRef.current = null
        scheduleReconnect()
      }

      ws.onerror = () => {
        try {
          ws.close()
        } catch {
          /* noop */
        }
      }
    }

    connect()

    return () => {
      aliveRef.current = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        try {
          wsRef.current.close()
        } catch {
          /* noop */
        }
        wsRef.current = null
      }
      setOnlineIds(new Set())
    }
  }, [user?.id])

  const isOnline = useCallback((id: string) => onlineIds.has(id), [onlineIds])

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
