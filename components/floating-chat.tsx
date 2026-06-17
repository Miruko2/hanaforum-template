"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { cdnUrl } from "@/lib/cdn-url"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { X, Send, Smile, Users, Hash } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { MENGMEGZI_USER_ID, HANAKO_DM_USERNAME, HANAKO_AVATAR } from "@/lib/hanako/constants"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useChatUI } from "@/contexts/chat-ui-context"
import { usePresence } from "@/contexts/presence-context"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import ChatUserCard from "./chat-user-card"
import { fetchUserCardData } from "@/lib/user-card"
import styles from "./floating-chat.module.css"

// 统一的展示消息形状（大厅与私聊都映射到这个）
interface DisplayMsg {
  id: string
  fromId: string
  username: string
  avatar_url?: string | null
  kind: "text" | "sticker"
  content: string
  // 仅「会话中实时新到」的消息为 true → 播放入场动效；历史与切换不动
  isNew?: boolean
}

interface Partner {
  id: string
  username: string
  avatar_url?: string | null
}

interface DmConv extends Partner {
  unread: number
}

// 当前会话：大厅，或与某人的私聊
type Active = { kind: "hall" } | ({ kind: "dm" } & Partner)

const MAX_LEN = 300
// 空闲预热：最多预拉最近这么多个私聊会话的历史进缓存（控量，纯文本流量很小）
const PREWARM_MAX_CONVS = 5
const STICKERS = ["happy", "shy", "worried", "yandere", "surprised", "sleepy"]
const ASSET_EXTS = ["jpg", "png", "webp", "gif"]

// Blur effect constants for scroll fade
const BLUR_FADE_ZONE = 50 // pixels from edge to start blur
const BLUR_MAX = 12 // max blur in pixels

// 触屏设备（安卓 WebView 等）：onScroll 中的 updateBlur 需要 rAF 节流，
// 否则逐事件 querySelectorAll + getBoundingClientRect + 写 inline filter
// 会在滑动时强制布局 + filter 光栅化 → 卡顿/花屏。桌面端直接调用即可。
const IS_TOUCH =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false)

const pairKey = (a: string, b: string) => [a, b].sort().join(":")

// localStorage key for persisting chat panel position
const POS_STORAGE_KEY = "floating-chat-pos"

interface PanelPosition {
  x: number
  y: number
}

function loadSavedPosition(): PanelPosition | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(POS_STORAGE_KEY)
    if (!raw) return null
    const pos = JSON.parse(raw) as PanelPosition
    if (typeof pos.x === "number" && typeof pos.y === "number") return pos
  } catch {}
  return null
}

function savePosition(pos: PanelPosition) {
  try {
    localStorage.setItem(POS_STORAGE_KEY, JSON.stringify(pos))
  } catch {}
}

// 「删除会话」是本地隐藏（私聊消息本身不删，避免误删双方记录）：
// 记录 convId → 隐藏时刻(ms)。loadConvs 据此过滤；若隐藏后该会话又有更新的消息
// （对方再发 / 自己重开），则取消隐藏恢复显示。仅本机生效。
const HIDDEN_CONVS_KEY = "floating-chat-hidden-convs"

function loadHiddenConvs(): Record<string, number> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(HIDDEN_CONVS_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return obj && typeof obj === "object" ? (obj as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function saveHiddenConvs(map: Record<string, number>) {
  try {
    localStorage.setItem(HIDDEN_CONVS_KEY, JSON.stringify(map))
  } catch {}
}

function hideConv(convId: string) {
  const map = loadHiddenConvs()
  map[convId] = Date.now()
  saveHiddenConvs(map)
}

function unhideConv(convId: string) {
  const map = loadHiddenConvs()
  if (map[convId] != null) {
    delete map[convId]
    saveHiddenConvs(map)
  }
}

// 「最后已读时刻」：convId → ms。打开/查看某会话时更新为当下。
// loadConvs 据此把「对方发来、且晚于已读时刻」的消息计为未读——这样即便
// 接收方离线、错过了 realtime 推送，再打开页面也能正确亮红点。仅本机生效。
const LAST_READ_KEY = "floating-chat-last-read"
// 安装基线：本功能首次运行的时刻。没有「最后已读」记录的会话以它为界，
// 只有「上线之后」的新消息才算未读，避免历史私聊一上来全亮红点。
const INSTALLED_AT_KEY = "floating-chat-installed-at"

function loadLastRead(): Record<string, number> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(LAST_READ_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw)
    return obj && typeof obj === "object" ? (obj as Record<string, number>) : {}
  } catch {
    return {}
  }
}

function saveLastRead(map: Record<string, number>) {
  try {
    localStorage.setItem(LAST_READ_KEY, JSON.stringify(map))
  } catch {}
}

function markConvRead(convId: string) {
  const map = loadLastRead()
  map[convId] = Date.now()
  saveLastRead(map)
}

function getInstalledAt(): number {
  if (typeof window === "undefined") return Date.now()
  try {
    const raw = localStorage.getItem(INSTALLED_AT_KEY)
    if (raw) {
      const n = Number(raw)
      if (Number.isFinite(n)) return n
    }
    const now = Date.now()
    localStorage.setItem(INSTALLED_AT_KEY, String(now))
    return now
  } catch {
    return Date.now()
  }
}

export default function FloatingChat() {
  const { user } = useSimpleAuth()
  const { toast } = useToast()

  // open / 未读红点由导航栏入口共享：本组件只读 open（决定渲染面板）、写 unread（红点数）。
  // pendingDm：外部（社交页「私聊」按钮）请求发起的私聊对象，消费后 clearPendingDm 清掉。
  const { open, setOpen, setUnread, pendingDm, clearPendingDm } = useChatUI()
  const router = useRouter()
  const [active, setActive] = useState<Active>({ kind: "hall" })
  const [convs, setConvs] = useState<DmConv[]>([])
  const [messages, setMessages] = useState<DisplayMsg[]>([])
  // 在线状态由全站 PresenceProvider 维护（CF Durable Object + WebSocket），
  // 登录即建连、断开即离线；本组件只读，不再本地维护心跳
  const { onlineUsers: rawOnline, isOnline: rawIsOnline } = usePresence()
  // hanako 是 AI、无真实 presence 连接，前端虚拟她「永远在线」：
  // 既出现在大厅在线头像条（置顶、恒在、不被挤掉），也让 DM 头部在线判断对她恒为真。
  // 注入只在本组件消费侧做，不污染全局 PresenceProvider 语义（其他用 usePresence()
  // 的地方，如社交页在线标记，不应把 hanako 当真人在线）。
  const online = useMemo(() => {
    if (rawOnline.some((u) => u.id === MENGMEGZI_USER_ID)) return rawOnline
    return [{ id: MENGMEGZI_USER_ID, username: HANAKO_DM_USERNAME, avatar_url: HANAKO_AVATAR }, ...rawOnline]
  }, [rawOnline])
  const isOnline = useCallback(
    (id: string) => id === MENGMEGZI_USER_ID || rawIsOnline(id),
    [rawIsOnline],
  )
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [showStickers, setShowStickers] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  // 右键菜单（关闭私聊）
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; convId: string; username: string } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  // 头像点击 → 弹出精简社交卡片（背景图/头像/签名 + 私聊/进入主页）
  const [avatarMenu, setAvatarMenu] = useState<{ x: number; y: number; partner: Partner } | null>(null)

  // Drag position state - persisted in localStorage
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const feedRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  // rAF 节流 ref（仅触屏设备使用）
  const blurRafRef = useRef<number | null>(null)
  const avatarRef = useRef<string | null>(null)
  const activeRef = useRef<Active>(active)
  const convsRef = useRef<DmConv[]>(convs)
  const openRef = useRef(open)
  // 会话消息缓存：key = "hall" 或 pairKey(双方)。
  // 切回看过的会话时立即回显缓存（秒开、不再先空屏），后台再静默拉最新覆盖。
  // ref 跨「面板开关」保留，故关掉面板再开也秒开；仅整页刷新才失效。
  const msgCacheRef = useRef<Map<string, DisplayMsg[]>>(new Map())

  // Load saved position on mount
  useEffect(() => {
    const saved = loadSavedPosition()
    if (saved) setPosition(saved)
  }, [])

  // 聊天窗开着时空闲预热「出现过的人」（消息作者 + 在线列表）的社交卡数据，
  // 点头像开卡即直出，不再等查询。fetchUserCardData 自带 60s 缓存 + 并发去重，
  // 消息频繁刷新也不会重复打查询；小延迟错峰，让位给消息渲染本身。
  useEffect(() => {
    if (!open || !user) return
    const ids = new Set<string>()
    for (const m of messages) if (m.fromId !== user.id) ids.add(m.fromId)
    for (const u of online) if (u.id !== user.id) ids.add(u.id)
    if (ids.size === 0) return
    const timer = setTimeout(() => {
      for (const id of ids) void fetchUserCardData(id)
    }, 600)
    return () => clearTimeout(timer)
  }, [open, messages, online, user])

  // Lock body scroll when chat is open (prevent touch event passthrough)
  useEffect(() => {
    if (!open) return

    const isMobile = window.innerWidth <= 640
    if (!isMobile) return

    // Save current scroll position
    const scrollY = window.scrollY
    const body = document.body

    // Prevent body scroll
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'

    return () => {
      // Restore body scroll
      body.style.position = ''
      body.style.top = ''
      body.style.width = ''
      window.scrollTo(0, scrollY)
    }
  }, [open])

  useEffect(() => {
    activeRef.current = active
  }, [active])
  useEffect(() => {
    convsRef.current = convs
  }, [convs])
  useEffect(() => {
    openRef.current = open
  }, [open])
  // 私聊未读总数 → 同步给导航栏红点（关闭面板时也持续更新）
  useEffect(() => {
    setUnread(convs.reduce((sum, c) => sum + c.unread, 0))
  }, [convs, setUnread])

  const myId = user?.id
  const myName =
    user?.user_metadata?.username || (user?.email ? user.email.split("@")[0] : "匿名")

  // 自己的头像（发送快照 + 心跳带上）
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

  // 加载私聊会话列表（侧边栏）。保留已有未读计数。
  const loadConvs = useCallback(async () => {
    if (!myId) return
    const { data, error } = await supabase
      .from("dm_messages")
      .select("sender_id,recipient_id,created_at")
      .order("created_at", { ascending: false })
      .limit(200)
    if (error || !data) return
    const rows = (data ?? []) as { sender_id: string; recipient_id: string; created_at: string }[]

    const lastRead = loadLastRead()
    const baseline = getInstalledAt() // 无「最后已读」记录的会话以此为界，只算上线后的新消息
    const hidden = loadHiddenConvs()
    let hiddenChanged = false

    // 一趟遍历：记录每会话最新消息时刻（rows 已按 created_at 倒序，首次遇到即最新）+ 统计未读
    const latestAt = new Map<string, number>()
    const unreadCount = new Map<string, number>()
    const partners: string[] = []
    for (const r of rows) {
      const other: string = r.sender_id === myId ? r.recipient_id : r.sender_id
      if (!other || other === myId) continue
      const ts = new Date(r.created_at).getTime()
      if (!latestAt.has(other)) latestAt.set(other, ts)
      if (!partners.includes(other)) partners.push(other)
      // 对方发来（sender 即对方）、且晚于「最后已读（无则用安装基线）」→ 未读，含离线期间错过的
      if (r.sender_id === other && ts > (lastRead[other] ?? baseline)) {
        unreadCount.set(other, (unreadCount.get(other) ?? 0) + 1)
      }
    }
    // 过滤被「删除」的会话；若隐藏后又有更新的消息则恢复并清掉隐藏标记
    const visible = partners.filter((id) => {
      const h = hidden[id]
      if (h == null) return true
      if ((latestAt.get(id) ?? 0) > h) {
        delete hidden[id]
        hiddenChanged = true
        return true
      }
      return false
    })
    if (hiddenChanged) saveHiddenConvs(hidden)
    if (visible.length === 0) {
      setConvs([])
      return
    }
    const { data: profs } = await supabase
      .from("profiles")
      .select("id,username,avatar_url")
      .in("id", visible)
    const pmap = new Map((profs ?? []).map((p: { id: string; username: string; avatar_url: string | null }) => [p.id, p]))
    setConvs((prev) => {
      const prevUnread = new Map(prev.map((c) => [c.id, c.unread]))
      return visible.map((id) => {
        const p = pmap.get(id)
        // 取「计算出的未读」与「内存里已累加的未读」较大值，避免覆盖实时已 +1 但还没读的
        const computed = unreadCount.get(id) ?? 0
        const inMem = prevUnread.get(id) ?? 0
        return {
          id,
          username: p?.username || "用户",
          avatar_url: p?.avatar_url ?? null,
          unread: Math.max(computed, inMem),
        }
      })
    })
  }, [myId])

  // 挂载即载入会话列表（不依赖面板是否打开）：关闭时也能算未读、亮红点
  useEffect(() => {
    if (myId) loadConvs()
  }, [myId, loadConvs])

  // 全局常驻：监听「发给我」的私聊 → 更新侧边栏 + 未读。
  // 不依赖面板是否打开——关闭时也要累积未读、让导航栏红点亮起来。
  useEffect(() => {
    if (!myId) return
    const ch = supabase
      .channel("dm_incoming")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_messages", filter: `recipient_id=eq.${myId}` },
        (payload) => {
          const m = payload.new as { sender_id: string }
          unhideConv(m.sender_id) // 对方又发来消息：若该会话曾被删除(隐藏)，恢复显示
          const a = activeRef.current
          // 仅当面板开着且正在看这个人才不计未读；其余（含面板关闭）一律 +1
          const viewing = openRef.current && a.kind === "dm" && a.id === m.sender_id
          if (viewing) markConvRead(m.sender_id) // 正在看：持续标记已读，避免切走后被当未读
          const known = convsRef.current.some((c) => c.id === m.sender_id)
          setConvs((prev) => {
            const exists = prev.find((c) => c.id === m.sender_id)
            if (exists) {
              return prev.map((c) =>
                c.id === m.sender_id ? { ...c, unread: viewing ? 0 : c.unread + 1 } : c,
              )
            }
            return [{ id: m.sender_id, username: "用户", avatar_url: null, unread: viewing ? 0 : 1 }, ...prev]
          })
          if (!known) loadConvs() // 新对话才回查资料，补全头像/名字
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [myId, loadConvs])

  // 在线状态全站化：由 PresenceProvider（CF Durable Object + WebSocket）统一维护，
  // 本组件通过 usePresence() 读 onlineUsers / isOnline。原本地心跳逻辑已移除。

  // 当前会话：加载历史 + 订阅实时（大厅 or 某个私聊）。
  // 缓存命中即秒开：切回看过的会话立即回显缓存，不再先空屏等查询；
  // 同时后台静默拉最新覆盖（stale-while-revalidate），保证最终一致。
  useEffect(() => {
    if (!open || !myId) return
    let alive = true

    const key = active.kind === "hall" ? "hall" : pairKey(myId, active.id)
    const cached = msgCacheRef.current.get(key)
    // 命中缓存：立即回显（清掉 isNew，切换不重放入场动效）；未命中才空屏等首查。
    setMessages(cached ? cached.map((m) => (m.isNew ? { ...m, isNew: false } : m)) : [])

    if (active.kind === "hall") {
      ;(async () => {
        const { data, error } = await supabase
          .from("chat_messages")
          .select("id,user_id,username,avatar_url,kind,content,created_at")
          .order("created_at", { ascending: false })
          .limit(100)
        if (!alive || error) return
        const rows = ((data ?? []) as ChatRow[]).slice().reverse()
        const mapped = rows.map(mapHall)
        msgCacheRef.current.set(key, mapped)
        setMessages(mapped)
      })()

      const msgChannel = supabase
        .channel("chat_room_messages")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
          const m = payload.new as ChatRow
          setMessages((prev) => {
            if (prev.some((x) => x.id === m.id)) return prev
            const next = [...prev, { ...mapHall(m), isNew: true }].slice(-200)
            msgCacheRef.current.set(key, next)
            return next
          })
        })
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages" }, (payload) => {
          const id = (payload.old as { id: string }).id
          setMessages((prev) => {
            const next = prev.filter((x) => x.id !== id)
            msgCacheRef.current.set(key, next)
            return next
          })
        })
        .subscribe()

      return () => {
        alive = false
        supabase.removeChannel(msgChannel)
      }
    }

    // 私聊
    const partner: Partner = { id: active.id, username: active.username, avatar_url: active.avatar_url }
    const pk = key // 私聊分支的缓存 key 即 pairKey
    ;(async () => {
      const { data, error } = await supabase
        .from("dm_messages")
        .select("id,sender_id,kind,content,created_at")
        .eq("pair_key", pk)
        .order("created_at", { ascending: false })
        .limit(100)
      if (!alive || error) return
      const rows = ((data ?? []) as DmRow[]).slice().reverse()
      const mapped = rows.map((m) => mapDm(m, myId, myName, partner))
      msgCacheRef.current.set(key, mapped)
      setMessages(mapped)
      markConvRead(partner.id) // 打开会话即视为已读，更新「最后已读」时刻
    })()

    const ch = supabase
      .channel(`dm_${pk}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages", filter: `pair_key=eq.${pk}` }, (payload) => {
        const m = payload.new as DmRow
        setMessages((prev) => {
          if (prev.some((x) => x.id === m.id)) return prev
          const next = [...prev, { ...mapDm(m, myId, myName, partner), isNew: true }].slice(-200)
          msgCacheRef.current.set(key, next)
          return next
        })
      })
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [open, myId, myName, active])

  // 空闲预热：面板打开后稍候，预拉最近若干个私聊会话的历史进缓存，
  // 让「整页刷新后首次点开」也能秒开。三重克制，避免浪费流量 / 踩实时：
  //   1) 仅最近 PREWARM_MAX_CONVS 个会话（convs 已按时间倒序）；
  //   2) 跳过当前正在看的会话、以及已在缓存里的会话；
  //   3) 查询回填时再判一次「仍未缓存」才写，绝不覆盖主查询/实时已填的内容。
  useEffect(() => {
    if (!open || !myId || convs.length === 0) return
    let cancelled = false
    const timer = setTimeout(() => {
      const a = activeRef.current
      const activeKey = a.kind === "hall" ? "hall" : pairKey(myId, a.id)
      const targets = convs.slice(0, PREWARM_MAX_CONVS).filter((c) => {
        const key = pairKey(myId, c.id)
        return key !== activeKey && !msgCacheRef.current.has(key)
      })
      for (const c of targets) {
        const key = pairKey(myId, c.id)
        const partner: Partner = { id: c.id, username: c.username, avatar_url: c.avatar_url }
        ;(async () => {
          const { data, error } = await supabase
            .from("dm_messages")
            .select("id,sender_id,kind,content,created_at")
            .eq("pair_key", key)
            .order("created_at", { ascending: false })
            .limit(100)
          if (cancelled || error || !data) return
          // 回填时再判一次：期间用户若已点开该会话（主查询/实时已填缓存），不覆盖
          if (msgCacheRef.current.has(key)) return
          const rows = (data as DmRow[]).slice().reverse()
          msgCacheRef.current.set(key, rows.map((m) => mapDm(m, myId, myName, partner)))
        })()
      }
    }, 800)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, myId, myName, convs])

  // Update blur effect for messages near edges
  const updateBlur = useCallback(() => {
    const container = feedRef.current
    if (!container) return

    const containerRect = container.getBoundingClientRect()
    const containerHeight = containerRect.height
    const scrollTop = container.scrollTop
    const isScrolled = scrollTop > 5
    const isAtBottom = container.scrollHeight - scrollTop - containerHeight < 60

    // Get all message rows
    const rows = container.querySelectorAll(`.${styles.row}`)
    const totalRows = rows.length

    rows.forEach((row, index) => {
      const rowRect = row.getBoundingClientRect()
      const top = rowRect.top - containerRect.top
      const bottom = rowRect.bottom - containerRect.top

      let t = 1 // 0 = fully blurred, 1 = fully clear

      // Don't blur the last 3 messages when at bottom (keep latest messages visible)
      const isNearEnd = index >= totalRows - 3
      const skipBottomBlur = isAtBottom && isNearEnd

      if (bottom < 0 || top > containerHeight) {
        // Completely outside
        t = 0
      } else if (!skipBottomBlur && top > containerHeight - BLUR_FADE_ZONE) {
        // Near bottom edge (skip for recent messages when at bottom)
        t = Math.max(0, (containerHeight - top) / BLUR_FADE_ZONE)
      } else if (isScrolled && top < BLUR_FADE_ZONE) {
        // Near top edge (only when scrolled)
        t = Math.max(0, top / BLUR_FADE_ZONE)
      }

      const blurAmount = BLUR_MAX * (1 - t)
      const opacityValue = 0.2 + 0.8 * t

      if (t < 0.99) {
        ;(row as HTMLElement).style.filter = `blur(${blurAmount.toFixed(2)}px)`
        ;(row as HTMLElement).style.opacity = opacityValue.toFixed(3)
      } else {
        ;(row as HTMLElement).style.filter = ""
        ;(row as HTMLElement).style.opacity = ""
      }
    })
  }, [])

  // 贴底才自动滚（看历史不被打断）
  const onScroll = () => {
    const el = feedRef.current
    if (el) {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
      if (IS_TOUCH) {
        // 触屏设备：rAF 合并连续 scroll 事件，一帧最多一次 updateBlur
        if (blurRafRef.current == null) {
          blurRafRef.current = requestAnimationFrame(() => {
            blurRafRef.current = null
            updateBlur()
          })
        }
      } else {
        updateBlur()
      }
    }
  }
  useEffect(() => {
    const el = feedRef.current
    if (el && atBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
    // Update blur after messages change (with small delay to allow DOM update)
    requestAnimationFrame(() => {
      requestAnimationFrame(updateBlur)
    })
  }, [messages, open, active, updateBlur])

  const send = useCallback(
    async (kind: "text" | "sticker", content: string) => {
      if (!user || sending) return
      const text = content.trim()
      if (!text) return
      const a = activeRef.current
      setSending(true)
      try {
        let error
        if (a.kind === "hall") {
          ;({ error } = await supabase
            .from("chat_messages")
            .insert([{ user_id: user.id, username: myName, avatar_url: avatarRef.current, kind, content: text }]))
        } else {
          ;({ error } = await supabase
            .from("dm_messages")
            .insert([{ pair_key: pairKey(user.id, a.id), sender_id: user.id, recipient_id: a.id, kind, content: text }]))
        }
        if (error) {
          const rl = (error as { code?: string }).code === "42501" || /row-level security/i.test(error.message || "")
          toast({
            title: rl ? "发太快了" : "发送失败",
            description: rl ? "慢一点～3 秒最多 3 条" : error.message || "请稍后重试",
            variant: "destructive",
          })
        } else if (a.kind === "dm" && a.id === MENGMEGZI_USER_ID && kind === "text") {
          // 私聊对象是 hanako：触发独立模型异步回复（fire-and-forget，失败静默）。
          // 她的回复经 dm 实时订阅自动出现在会话里，这里无需处理返回值。
          ;(async () => {
            try {
              const { data: s } = await supabase.auth.getSession()
              const tok = s?.session?.access_token
              if (!tok) return
              await fetch(apiUrl("/api/hanako-dm"), {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
                body: JSON.stringify({ content: text }),
              })
            } catch {
              // 静默：她没回不影响用户已发出的消息
            }
          })()
        }
      } catch (e) {
        toast({ title: "发送失败", description: (e as Error)?.message || "请稍后重试", variant: "destructive" })
      } finally {
        setSending(false)
      }
    },
    [user, sending, myName, toast],
  )

  const submitText = () => {
    const t = input.trim()
    if (!t) return
    send("text", t)
    setInput("")
    // Reset textarea height after clearing
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [])

  // 发起 / 切到与某人的私聊
  const startDm = useCallback(
    (p: Partner) => {
      if (!myId || p.id === myId) return
      unhideConv(p.id) // 主动重开会话：取消之前的删除(隐藏)
      setActive({ kind: "dm", id: p.id, username: p.username, avatar_url: p.avatar_url ?? null })
      setConvs((prev) => {
        const exists = prev.find((c) => c.id === p.id)
        if (exists) return prev.map((c) => (c.id === p.id ? { ...c, unread: 0, username: p.username, avatar_url: p.avatar_url ?? null } : c))
        return [{ id: p.id, username: p.username, avatar_url: p.avatar_url ?? null, unread: 0 }, ...prev]
      })
      setShowStickers(false)
    },
    [myId],
  )

  const switchTo = useCallback((a: Active) => {
    setActive(a)
    if (a.kind === "dm") setConvs((prev) => prev.map((c) => (c.id === a.id ? { ...c, unread: 0 } : c)))
    setShowStickers(false)
  }, [])

  // 消费外部「向某人发起私聊」请求（社交页 /user 的「私聊」按钮）。
  // startDmWith 已负责打开面板(setOpen(true))，这里只需切到对应 DM 并清掉请求。
  useEffect(() => {
    if (!pendingDm || !myId) return
    if (pendingDm.id === myId) {
      clearPendingDm()
      return
    }
    startDm({ id: pendingDm.id, username: pendingDm.username, avatar_url: pendingDm.avatar_url ?? null })
    clearPendingDm()
  }, [pendingDm, myId, startDm, clearPendingDm])

  // 关闭（删除）一个私聊会话
  const closeDm = useCallback((convId: string) => {
    hideConv(convId) // 持久化隐藏：刷新后不再复活（除非之后有更新的消息）
    setConvs((prev) => prev.filter((c) => c.id !== convId))
    // 如果正在看这个人的私聊，切回大厅
    if (activeRef.current.kind === "dm" && activeRef.current.id === convId) {
      setActive({ kind: "hall" })
    }
    setCtxMenu(null)
  }, [])

  // 点击/触摸外部关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null)
      }
    }
    document.addEventListener("mousedown", handler)
    document.addEventListener("touchstart", handler)
    return () => {
      document.removeEventListener("mousedown", handler)
      document.removeEventListener("touchstart", handler)
    }
  }, [ctxMenu])

  if (!user) return null

  const headerLabel =
    active.kind === "hall"
      ? "聊天大厅"
      : active.id === MENGMEGZI_USER_ID
        ? HANAKO_DM_USERNAME
        : active.username

  return (
    <>
    <AnimatePresence>
      {open && (
        <motion.div
          className={styles.panel}
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          drag
          dragMomentum={false}
          dragElastic={0}
          onDragStart={() => setIsDragging(true)}
          onDragEnd={(_, info) => {
            setIsDragging(false)
            // Calculate final position based on offset
            const current = position || { x: 0, y: 0 }
            const newPos = {
              x: current.x + info.offset.x,
              y: current.y + info.offset.y,
            }
            setPosition(newPos)
            savePosition(newPos)
          }}
          style={{
            // Apply saved position offset
            x: position?.x ?? 0,
            y: position?.y ?? 0,
          }}
        >
          {/* 侧边栏：大厅 + 私聊会话切换 */}
          <div className={styles.rail}>
            <button
              className={`${styles.railItem} ${active.kind === "hall" ? styles.railActive : ""}`}
              onClick={() => switchTo({ kind: "hall" })}
              title="聊天大厅"
              aria-label="聊天大厅"
            >
              <Hash className="h-5 w-5" />
            </button>
            {convs.length > 0 && <div className={styles.railDivider} />}
            <div className={styles.railList}>
              {convs.map((c) => {
                // hanako 的 profiles 行可能脏（撞名后缀 + 无头像），会话列表里
                // 也用固定名字/头像，与大厅在线条、消息渲染保持一致。
                const isHanako = c.id === MENGMEGZI_USER_ID
                const uname = isHanako ? HANAKO_DM_USERNAME : c.username
                const av = isHanako ? HANAKO_AVATAR : c.avatar_url
                return (
                <button
                  key={c.id}
                  className={`${styles.railItem} ${active.kind === "dm" && active.id === c.id ? styles.railActive : ""}`}
                  onClick={() => switchTo({ kind: "dm", id: c.id, username: uname, avatar_url: av })}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setCtxMenu({ x: e.clientX, y: e.clientY, convId: c.id, username: uname })
                  }}
                  onTouchStart={(e) => {
                    const touch = e.touches[0]
                    longPressTimerRef.current = setTimeout(() => {
                      setCtxMenu({ x: touch.clientX, y: touch.clientY, convId: c.id, username: uname })
                    }, 500)
                  }}
                  onTouchEnd={() => {
                    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
                  }}
                  onTouchMove={() => {
                    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
                  }}
                  title={uname}
                >
                  <UserAvatar username={uname} avatarUrl={av} size={34} />
                  {c.unread > 0 && <span className={styles.railBadge}>{c.unread > 9 ? "9+" : c.unread}</span>}
                </button>
                )
              })}
            </div>
          </div>

          {/* 主区 */}
          <div className={styles.main}>
            <header className={styles.header}>
              <div className={styles.headerTitle}>
                <span className={styles.headerName}>{headerLabel}</span>
                {active.kind === "hall" ? (
                  <span className={styles.headerOnline}>
                    <Users className="h-3.5 w-3.5" />
                    {online.length} 在聊
                  </span>
                ) : (
                  // hanako 前端虚拟永远在线（见 usePresence 派生），isOnline 对她恒为真，
                  // 故这里与真人统一走在线/离线分支，显示绿点「在线」。
                  <span className={styles.headerOnline}>
                    <span className={isOnline(active.id) ? styles.onlineDot : styles.offlineDot} />
                    {isOnline(active.id) ? "在线" : "离线"}
                  </span>
                )}
              </div>
              <button className={styles.headerClose} onClick={() => setOpen(false)} aria-label="关闭">
                <X className="h-5 w-5" />
              </button>
            </header>

            {active.kind === "hall" && online.length > 0 && (
              <div className={styles.onlineStrip}>
                {online.slice(0, 12).map((u) => {
                  // hanako 在 online 首位（见 usePresence 派生），恒在、不被挤掉；
                  // 她的 profiles 行可能脏（撞名后缀 + 无头像），这里强制用固定头像/名字。
                  const isHanako = u.id === MENGMEGZI_USER_ID
                  const uname = isHanako ? HANAKO_DM_USERNAME : u.username
                  const av = isHanako ? HANAKO_AVATAR : u.avatar_url
                  return (
                  <button
                    key={u.id}
                    className={styles.onlineAvatarBtn}
                    onPointerEnter={() => void fetchUserCardData(u.id)}
                    onClick={(e) =>
                      setAvatarMenu({
                        x: e.clientX,
                        y: e.clientY,
                        partner: { id: u.id, username: uname, avatar_url: av },
                      })
                    }
                    title={uname}
                  >
                    <UserAvatar username={uname} avatarUrl={av} size={22} />
                  </button>
                  )
                })}
              </div>
            )}

            <div ref={feedRef} className={styles.feed} onScroll={onScroll}>
              {messages.length === 0 ? (
                <div className={styles.empty}>
                  {active.kind === "hall" ? "还没有人说话，来打个招呼吧～" : `和 ${active.username} 开始聊天吧～`}
                </div>
              ) : (
                messages.map((m) => {
                  const mine = m.fromId === user.id
                  return (
                    <div key={m.id} className={`${styles.row} ${mine ? styles.rowMine : styles.rowOther} ${m.isNew ? styles.rowNew : ""}`}>
                      {!mine &&
                        (active.kind === "hall" ? (
                          <button
                            className={styles.avatarBtn}
                            onPointerEnter={() => void fetchUserCardData(m.fromId)}
                            onClick={(e) =>
                              setAvatarMenu({
                                x: e.clientX,
                                y: e.clientY,
                                partner: { id: m.fromId, username: m.username, avatar_url: m.avatar_url },
                              })
                            }
                            title={m.username}
                          >
                            <UserAvatar username={m.username} avatarUrl={m.avatar_url} size={28} />
                          </button>
                        ) : (
                          <UserAvatar username={m.username} avatarUrl={m.avatar_url} size={28} />
                        ))}
                      <div className={styles.msgCol}>
                        {!mine && active.kind === "hall" && <span className={styles.msgName}>{m.username}</span>}
                        {m.kind === "sticker" ? (
                          <HanakoImg
                            base={`/hanako/stickers/${m.content}`}
                            className={styles.msgSticker}
                            onClick={(src) => setLightboxSrc(src)}
                          />
                        ) : (
                          <div className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleOther}`}>{m.content}</div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <AnimatePresence>
              {showStickers && (
                <motion.div
                  className={styles.stickerPicker}
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: 10 }}
                  transition={{
                    type: "spring",
                    stiffness: 400,
                    damping: 25,
                    mass: 0.8,
                  }}
                >
                  {STICKERS.map((id) => (
                    <button
                      key={id}
                      className={styles.stickerBtn}
                      onClick={() => {
                        send("sticker", id)
                        setShowStickers(false)
                      }}
                      aria-label={id}
                    >
                      <HanakoImg
                        base={`/hanako/stickers/${id}`}
                        alt={id}
                        onGiveUp={(img) => {
                          const btn = img.closest("button")
                          if (btn) (btn as HTMLElement).style.display = "none"
                        }}
                      />
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <footer className={styles.footer}>
              <button className={styles.iconBtn} onClick={() => setShowStickers((s) => !s)} aria-label="表情包">
                <Smile className="h-5 w-5" />
              </button>
              <textarea
                ref={textareaRef}
                className={styles.input}
                value={input}
                rows={1}
                onChange={(e) => {
                  setInput(e.target.value.slice(0, MAX_LEN))
                  autoResize(e.currentTarget)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    submitText()
                  }
                }}
                placeholder={active.kind === "hall" ? "对大厅说点什么…" : `私聊 ${active.username}…`}
                maxLength={MAX_LEN}
              />
              <button className={styles.send} onClick={submitText} disabled={sending || !input.trim()} aria-label="发送">
                <Send className="h-4 w-4" />
              </button>
            </footer>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    {ctxMenu && createPortal(
      <div
        ref={ctxMenuRef}
        className={styles.ctxMenu}
        style={{ left: ctxMenu.x, top: ctxMenu.y }}
      >
        <button className={styles.ctxMenuItem} onClick={() => closeDm(ctxMenu.convId)}>
          删除会话
        </button>
      </div>,
      document.body,
    )}

    {avatarMenu && (
      <ChatUserCard
        target={avatarMenu.partner}
        onClose={() => setAvatarMenu(null)}
        onDm={() => {
          startDm(avatarMenu.partner)
          setAvatarMenu(null)
        }}
        onGoProfile={() => {
          const id = avatarMenu.partner.id
          setAvatarMenu(null)
          setOpen(false)
          router.push(`/user?id=${id}`)
        }}
      />
    )}

    {/* 表情包灯箱 */}
    <AnimatePresence>
      {lightboxSrc && (
        <motion.div
          className={styles.lightbox}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => setLightboxSrc(null)}
        >
          <motion.img
            src={lightboxSrc}
            alt=""
            className={styles.lightboxImg}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            onClick={(e) => e.stopPropagation()}
          />
        </motion.div>
      )}
    </AnimatePresence>
    </>
  )
}

// ───────── 数据映射 ─────────

interface ChatRow {
  id: string
  user_id: string
  username: string
  avatar_url?: string | null
  kind: "text" | "sticker"
  content: string
}
interface DmRow {
  id: string
  sender_id: string
  kind: "text" | "sticker"
  content: string
}

function mapHall(m: ChatRow): DisplayMsg {
  return { id: m.id, fromId: m.user_id, username: m.username, avatar_url: m.avatar_url, kind: m.kind, content: m.content }
}
function mapDm(m: DmRow, myId: string, myName: string, partner: Partner): DisplayMsg {
  const mine = m.sender_id === myId
  // 私信AI 的 profiles 行可能是撞名后缀("hanako_1")且无头像；她的消息一律用固定名字/头像，
  // 不读那条脏数据。私信面向展示名用「萌萌子」（HANAKO_DM_USERNAME，与弹幕墙的 hanako 解耦）。
  const fromHanako = m.sender_id === MENGMEGZI_USER_ID
  return {
    id: m.id,
    fromId: m.sender_id,
    username: mine ? myName : fromHanako ? HANAKO_DM_USERNAME : partner.username,
    avatar_url: mine ? null : fromHanako ? HANAKO_AVATAR : partner.avatar_url ?? null,
    kind: m.kind,
    content: m.content,
  }
}

// ───────── 子组件 ─────────

function UserAvatar({
  username,
  avatarUrl,
  size = 32,
}: {
  username: string
  avatarUrl?: string | null
  size?: number
}) {
  const initial = (username?.[0] || "?").toUpperCase()
  return (
    <div className={styles.uavatar} style={{ width: size, height: size, fontSize: size * 0.45 }}>
      <span className={styles.uavatarFallback}>{initial}</span>
      {avatarUrl && (
        <img
          src={cdnUrl(avatarUrl) ?? undefined}
          alt={username}
          className={styles.uavatarImg}
          onError={(e) => {
            e.currentTarget.style.display = "none"
          }}
        />
      )}
    </div>
  )
}

// 加载 public/hanako 下的图片（头像 / 表情包），格式不限：依次尝试 jpg→png→webp→gif，
// 全部失败才放弃（默认隐藏，或交给 onGiveUp）。
// 使用 fetch HEAD 请求检查，避免 404 错误污染控制台。
function HanakoImg({
  base,
  alt = "",
  className,
  onGiveUp,
  onClick,
}: {
  base: string
  alt?: string
  className?: string
  onGiveUp?: (img: HTMLImageElement) => void
  onClick?: (src: string) => void
}) {
  const [src, setSrc] = useState<string | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    let cancelled = false

    const tryLoad = async () => {
      for (const ext of ASSET_EXTS) {
        const url = `${base}.${ext}`
        try {
          const res = await fetch(url, { method: "HEAD" })
          if (cancelled) return
          if (res.ok) {
            setSrc(url)
            return
          }
        } catch {
          if (cancelled) return
          // Network error, try next format
        }
      }
      // All formats failed
      if (!cancelled) {
        if (onGiveUp && imgRef.current) {
          onGiveUp(imgRef.current)
        } else {
          setSrc("__failed__")
        }
      }
    }

    tryLoad()
    return () => { cancelled = true }
  }, [base, onGiveUp])

  if (src === "__failed__") {
    return <img ref={imgRef} alt={alt} className={className} style={{ display: "none" }} />
  }

  if (!src) {
    return <img ref={imgRef} alt={alt} className={className} style={{ visibility: "hidden" }} />
  }

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      className={className}
      style={onClick ? { cursor: "pointer" } : undefined}
      onClick={onClick ? () => onClick(src) : undefined}
    />
  )
}
