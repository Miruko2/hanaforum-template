"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { cdnUrl } from "@/lib/cdn-url"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { X, Send, Smile, Users, Hash, CalendarDays } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { MENGMEGZI_USER_ID, HANAKO_DM_USERNAME, HANAKO_AVATAR, normalizeEmotion, DM_KEEP_RECENT_MSGS, HALL_CHIME_IN_PROBABILITY, HALL_MENTION_REGEX } from "@/lib/hanako/constants"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useChatUI } from "@/contexts/chat-ui-context"
import { usePresence } from "@/contexts/presence-context"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import ChatUserCard from "./chat-user-card"
import ChatDateRail from "./chat-date-rail"
import { cnDate, cnDayRangeUTC, type DateBucket } from "@/lib/cn-date"
import { fetchUserCardData } from "@/lib/user-card"
import { guardVerify, openVerifyGate } from "@/lib/verify-gate-bus"
import styles from "./floating-chat.module.css"

// 统一的展示消息形状（大厅与私聊都映射到这个）
interface DisplayMsg {
  id: string
  fromId: string
  username: string
  avatar_url?: string | null
  kind: "text" | "sticker"
  content: string
  // 消息时刻：既用于「上翻历史」的游标，也用于缓存命中后合并去重时按时间排序
  created_at: string
  // 仅「会话中实时新到」的消息为 true → 播放入场动效；历史与切换不动
  isNew?: boolean
  // 私信已读回执：对方读过这条（我发的）消息的时刻；大厅消息恒 undefined
  read_at?: string | null
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
// 一页历史的条数：首屏加载、空闲预热、上翻分页统一用它。
// 索引 idx_dm_pair_created (pair_key, created_at) 支撑，游标查询在万条里也走索引、毫秒级。
const PAGE_SIZE = 100
// 空闲预热：最多预拉最近这么多个私聊会话的历史进缓存（控量，纯文本流量很小）
const PREWARM_MAX_CONVS = 5
const STICKERS = ["happy", "shy", "confused", "cuddle", "excited", "sleepy"]
const ASSET_EXTS = ["jpg", "png", "webp", "gif"]

// 滚动渐入高斯模糊动效已禁用（原常量 BLUR_FADE_ZONE=50 / BLUR_MAX=12 已移除）。
// 详见下方 updateBlur 注释。

// 触屏设备（安卓 WebView 等）：onScroll 中的 updateBlur 需要 rAF 节流，
// 否则逐事件 querySelectorAll + getBoundingClientRect + 写 inline filter
// 会在滑动时强制布局 + filter 光栅化 → 卡顿/花屏。桌面端直接调用即可。
const IS_TOUCH =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches ?? false)

// 前插历史时的滚动锚定要在「绘制前」补偿 scrollTop，否则会闪一下跳位 → 用 useLayoutEffect。
// 但客户端组件 SSR 阶段用 useLayoutEffect 会告警，故服务端退回 useEffect（SSR 不跑布局补偿）。
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

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
  // @ 补全菜单：输入框敲 @ 时弹出萌萌子选项，点击补全 @萌萌子+空格
  const [mentionOpen, setMentionOpen] = useState(false)
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

  // ── 历史分页（上翻看更早消息）─────────────────────────────────────────────
  // 游标：当前会话「已加载的最老一条」的 (created_at, id)，作为上翻查询的边界。
  // 由下方 effect 从 messages[0] 同步，始终指向真实最老一条（本期不裁剪历史）。
  const oldestCursorRef = useRef<{ created_at: string; id: string } | null>(null)
  // 是否还有更早历史可翻：上次查询满页(=PAGE_SIZE)即可能还有；不足一页说明到顶。
  // 乐观初始 true，首查/上翻据 data.length 收敛。用 ref 不触发额外渲染。
  const hasMoreRef = useRef(true)
  // 正在上翻：防抖 + 防并发重复拉取（scroll 高频触发）。
  const loadingOlderRef = useRef(false)
  // 前插锚定：记录「插入更早消息前」的滚动几何，layout 阶段据此补偿 scrollTop，视线钉住不跳。
  const pendingAnchorRef = useRef<{ prevHeight: number; prevTop: number } | null>(null)

  // ── 窗口模式（日期跳转）──────────────────────────────────────────────────
  // 跳到历史某天后，messages 变成「那段窗口」而非直达最新尾。
  // isAtLiveTail：当前数组尾部是不是真·最新。true=正常实时模式；false=在看历史窗口。
  // ref 供实时/滚动回调读最新值；state 仅驱动 UI（回到最新按钮、提示）。
  const isAtLiveTailRef = useRef(true)
  const [atLiveTail, setAtLiveTail] = useState(true)
  const setLiveTail = useCallback((v: boolean) => {
    isAtLiveTailRef.current = v
    setAtLiveTail(v)
  }, [])
  // 已加载的最新一条游标（messages[末]）；loadNewer 据此往更新方向翻。
  const newestCursorRef = useRef<{ created_at: string; id: string } | null>(null)
  const loadingNewerRef = useRef(false)
  // 窗口模式下、用户没在看的最新段又来了多少条（驱动「N 条新消息」提示）。
  const [newWhileAway, setNewWhileAway] = useState(0)

  // ── 日期索引（刻度轨数据）────────────────────────────────────────────────
  // key → 该会话有消息的日期+条数（dm_active_dates，新→旧）。缓存避免重复 RPC。
  const activeDatesRef = useRef<Map<string, DateBucket[]>>(new Map())
  const [activeDates, setActiveDates] = useState<DateBucket[]>([])
  // 刻度轨当前高亮日期：滚动空闲时按读线处消息算；跳转时设为目标日。
  const [activeDate, setActiveDate] = useState<string | null>(null)
  // 刻度轨是否展开：默认收起，点 header 的按钮才出现（私聊+大厅都有）。
  const [railOpen, setRailOpen] = useState(false)
  // 滚动空闲去抖：算 activeDate 是一次性 O(n) DOM 读，挪到停滚后再做。
  const scrollIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // messages 的 ref 镜像：供 jumpToDate 等回调读当前列表，不必把 messages 进依赖反复重建。
  const messagesRef = useRef<DisplayMsg[]>([])

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

  // 私信已读：把「对方发给我、未读」的消息在服务端置 read_at=now（单向、仅本人）。
  // 与本地 markConvRead（维护未读计数）并行调用：本地计数逻辑不动，这里只同步回执到服务端，
  // 让发送方经 realtime UPDATE 订阅看到「已读」。fire-and-forget，失败静默。
  const markDmReadServer = useCallback(async (partnerId: string) => {
    if (!myId) return
    try {
      const { data: sd } = await supabase.auth.getSession()
      const tok = sd?.session?.access_token
      if (!tok) return
      await fetch(apiUrl("/api/dm-read"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ pair_key: pairKey(myId, partnerId) }),
      })
    } catch {
      // 静默：标记失败不影响本地未读计数与聊天
    }
  }, [myId])

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
          if (viewing) {
            markConvRead(m.sender_id) // 正在看：持续标记已读，避免切走后被当未读
            void markDmReadServer(m.sender_id) // 同步回执到服务端
          }
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
  }, [myId, loadConvs, markDmReadServer])

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

    // 切会话即重置分页 + 窗口模式状态：清并发锁、乐观置「可能还有更早」（待首查据 data.length 收敛）、
    // 回到实时模式、清「N条新消息」、刻度轨数据先回显缓存（无则空，待 RPC 填）。
    loadingOlderRef.current = false
    loadingNewerRef.current = false
    hasMoreRef.current = true
    setLiveTail(true)
    setNewWhileAway(0)
    setActiveDate(null)
    setRailOpen(false) // 切会话先收起刻度轨，由用户在新会话里再点开（懒拉对应日期）
    setActiveDates(activeDatesRef.current.get(key) ?? [])

    if (active.kind === "hall") {
      ;(async () => {
        const { data, error } = await supabase
          .from("chat_messages")
          .select("id,user_id,username,avatar_url,kind,content,created_at")
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE)
        if (!alive || error) return
        // 满页 → 可能还有更早历史；不足一页 → 已到顶
        hasMoreRef.current = (data?.length ?? 0) >= PAGE_SIZE
        const rows = ((data ?? []) as ChatRow[]).slice().reverse()
        const mapped = rows.map(mapHall)
        // 有缓存（可能已上翻出更早历史）→ 合并保历史；无缓存 → 直接用最新一页
        setMessages((prev) => {
          const next = cached ? mergeMsgs(prev, mapped) : mapped
          msgCacheRef.current.set(key, next)
          return next
        })
      })()

      const msgChannel = supabase
        .channel("chat_room_messages")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
          const m = payload.new as ChatRow
          noteActiveDate(key, m.created_at) // 新消息日期并入刻度轨
          if (isAtLiveTailRef.current) {
            setMessages((prev) => {
              if (prev.some((x) => x.id === m.id)) return prev
              // 不再 slice(-200)：那会把上翻出来的历史从头部吃掉（看历史时尤其会跳没）。
              // 单会话内的实时增长由后续虚拟化（Phase 2）处理，本期保完整列表。
              const next = [...prev, { ...mapHall(m), isNew: true }]
              msgCacheRef.current.set(key, next)
              return next
            })
          } else {
            // 窗口模式（在看历史）：不进可见列表，只累加提示 + 追缓存（保持缓存=最新尾）
            const cached2 = msgCacheRef.current.get(key)
            if (cached2 && !cached2.some((x) => x.id === m.id)) {
              msgCacheRef.current.set(key, [...cached2, mapHall(m)])
            }
            setNewWhileAway((n) => n + 1)
          }
          // 萌萌子大厅发言触发（不受是否在看历史影响，照常）：每来一条「非萌萌子自己发的」新消息——
          // 1) 文本里 @萌萌子（HALL_MENTION_REGEX）→ 必回：force=true 直接调，绕过概率与冷却；
          // 2) 否则按 HALL_CHIME_IN_PROBABILITY 概率掷骰插话。
          // 萌萌子自己的发言不触发（防递归）；表情包消息无文本不检测 @。fire-and-forget，失败静默。
          if (m.user_id !== MENGMEGZI_USER_ID && user) {
            const mentioned = m.kind === "text" && HALL_MENTION_REGEX.test(m.content)
            const chimeIn = mentioned || Math.random() < HALL_CHIME_IN_PROBABILITY
            if (chimeIn) {
              void (async () => {
                try {
                  const { data: sd } = await supabase.auth.getSession()
                  const tok = sd?.session?.access_token
                  if (!tok) return
                  await fetch(apiUrl("/api/hall-mengmegzi"), {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
                    body: JSON.stringify({ force: mentioned }),
                  })
                } catch {
                  // 静默：触发失败不影响大厅消息显示
                }
              })()
            }
          }
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
        .select("id,sender_id,kind,content,created_at,read_at")
        .eq("pair_key", pk)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE)
      if (!alive || error) return
      // 满页 → 可能还有更早历史；不足一页 → 已到顶
      hasMoreRef.current = (data?.length ?? 0) >= PAGE_SIZE
      const rows = ((data ?? []) as DmRow[]).slice().reverse()
      const mapped = rows.map((m) => mapDm(m, myId, myName, partner))
      // 有缓存（可能已上翻出更早历史）→ 合并保历史；无缓存 → 直接用最新一页
      setMessages((prev) => {
        const next = cached ? mergeMsgs(prev, mapped) : mapped
        msgCacheRef.current.set(key, next)
        return next
      })
      markConvRead(partner.id) // 打开会话即视为已读，更新「最后已读」时刻
      void markDmReadServer(partner.id) // 同步回执到服务端，让发送方看到「已读」
    })()

    const ch = supabase
      .channel(`dm_${pk}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages", filter: `pair_key=eq.${pk}` }, (payload) => {
        const m = payload.new as DmRow
        noteActiveDate(key, m.created_at) // 新消息日期并入刻度轨
        if (!isAtLiveTailRef.current) {
          // 窗口模式：这条属于用户没在看的最新段——不进可见列表，只累加提示；
          // 仍追到缓存里（缓存恒=最新尾，回到最新时即时可用、保持一致）。
          const cached = msgCacheRef.current.get(key)
          if (cached && !cached.some((x) => x.id === m.id)) {
            msgCacheRef.current.set(key, [...cached, mapDm(m, myId, myName, partner)])
          }
          setNewWhileAway((n) => n + 1)
          return
        }
        setMessages((prev) => {
          if (prev.some((x) => x.id === m.id)) return prev
          // 不再 slice(-200)：那会把上翻出来的历史从头部吃掉（看历史时尤其会跳没）。
          // 单会话内的实时增长由后续虚拟化（Phase 2）处理，本期保完整列表。
          const next = [...prev, { ...mapDm(m, myId, myName, partner), isNew: true }]
          msgCacheRef.current.set(key, next)
          return next
        })
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "dm_messages", filter: `pair_key=eq.${pk}` }, (payload) => {
        // 对方把我发的某条消息置 read_at → 更新本地该消息，气泡出现「已读」
        const m = payload.new as DmRow
        if (!m.read_at) return
        setMessages((prev) => {
          const idx = prev.findIndex((x) => x.id === m.id)
          if (idx < 0 || prev[idx].read_at) return prev
          const next = prev.slice()
          next[idx] = { ...next[idx], read_at: m.read_at }
          msgCacheRef.current.set(key, next)
          return next
        })
      })
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [open, myId, myName, active, markDmReadServer])

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
            .select("id,sender_id,kind,content,created_at,read_at")
            .eq("pair_key", key)
            .order("created_at", { ascending: false })
            .limit(PAGE_SIZE)
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

  // 空闲预压缩：面板开着、在和萌萌子私聊、且 90s 没有新消息时，静默调 /api/dm-compress，
  // 让超阈值的旧消息在两次回复之间的空闲期折叠成摘要，回复路由里极少需要同步压缩、不卡顿。
  // 依赖 messages：每来新消息就重置定时器；90s 不动才触发。失败/无需压缩都静默。
  // 本地门槛：缓存消息不足一个保留窗口（< KEEP 条）的短对话压根不可能积压、不发请求；
  // 够多才问后端（后端按 TRIGGER 阈值权威判定，未超则零成本返回）。客户端最多缓存约 100 条，
  // KEEP=80 落在缓存内，这道门槛才真正有效（旧实现按 token 估算永远到不了、等于没触发）。
  useEffect(() => {
    if (!open || !myId) return
    if (active.kind !== "dm" || active.id !== MENGMEGZI_USER_ID) return
    if (messages.length < DM_KEEP_RECENT_MSGS) return
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { data: s } = await supabase.auth.getSession()
          const tok = s?.session?.access_token
          if (!tok) return
          await fetch(apiUrl("/api/dm-compress"), {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
          })
        } catch {
          // 静默：预压缩失败不影响聊天
        }
      })()
    }, 90_000)
    return () => clearTimeout(timer)
  }, [open, myId, active, messages])

  // 滚动时上下边缘的高斯模糊渐入动效已禁用。
  //
  // 原动效：靠近 feed 顶/底各 50px 时给整行 row 加 blur(最多12px) + 降低 opacity，
  // 营造文字从模糊渐入的出场感。但当某条消息文本很长（占据大半屏高度）时，
  // 该行的可见部分会持续落在边缘模糊带内 → 整条长消息几乎全程高斯模糊，
  // 无法正常阅读。滚动阅读体验优先于该装饰性动效，故直接关闭。
  //
  // 这里保留函数签名与调用点（onScroll / messages 变化时仍会调用），
  // 但只做一次清理：清掉可能残留的 inline filter/opacity，避免旧 DOM 节点
  // 卡在模糊态。
  const updateBlur = useCallback(() => {
    const container = feedRef.current
    if (!container) return
    const rows = container.querySelectorAll<HTMLElement>(`.${styles.row}`)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row.style.filter || row.style.opacity) {
        row.style.filter = ""
        row.style.opacity = ""
      }
    }
  }, [])

  // 上翻加载更早一页历史。以「当前最老一条」为游标查 created_at 更早的 PAGE_SIZE 条，
  // 去重后前插到列表头。多重守卫：并发锁、无更多则不查、拉取期间切了会话则丢弃结果。
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreRef.current || !myId) return
    const cursor = oldestCursorRef.current
    if (!cursor) return
    const a = activeRef.current
    const key = a.kind === "hall" ? "hall" : pairKey(myId, a.id)
    loadingOlderRef.current = true
    try {
      let older: DisplayMsg[]
      let pageFull: boolean
      if (a.kind === "hall") {
        const { data, error } = await supabase
          .from("chat_messages")
          .select("id,user_id,username,avatar_url,kind,content,created_at")
          .lt("created_at", cursor.created_at)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE)
        if (error) return
        const rows = (data ?? []) as ChatRow[]
        pageFull = rows.length >= PAGE_SIZE
        older = rows.slice().reverse().map(mapHall)
      } else {
        const partner: Partner = { id: a.id, username: a.username, avatar_url: a.avatar_url }
        const { data, error } = await supabase
          .from("dm_messages")
          .select("id,sender_id,kind,content,created_at,read_at")
          .eq("pair_key", key)
          .lt("created_at", cursor.created_at)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE)
        if (error) return
        const rows = (data ?? []) as DmRow[]
        pageFull = rows.length >= PAGE_SIZE
        older = rows.slice().reverse().map((m) => mapDm(m, myId, myName, partner))
      }
      // 拉取期间用户可能切了会话：当前会话已变则整批丢弃，绝不把 A 的历史插进 B
      const cur = activeRef.current
      const curKey = cur.kind === "hall" ? "hall" : pairKey(myId, cur.id)
      if (curKey !== key) return
      hasMoreRef.current = pageFull
      if (older.length === 0) return
      // 前插锚定：插入前记录滚动几何，layout effect 据此补偿，视线钉住不跳
      const el = feedRef.current
      if (el) pendingAnchorRef.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop }
      setMessages((prev) => {
        const existing = new Set(prev.map((m) => m.id))
        const merged = [...older.filter((m) => !existing.has(m.id)), ...prev]
        // 仅正常模式（缓存=最新尾数组）才回写缓存；窗口模式(!liveTail)上翻的是历史窗口，不能污染缓存
        if (isAtLiveTailRef.current) msgCacheRef.current.set(key, merged)
        return merged
      })
    } finally {
      loadingOlderRef.current = false
    }
  }, [myId, myName])

  // 下滑加载更新一页（仅窗口模式有意义：正常模式尾部已是最新、靠实时追加）。
  // 以「当前最新一条」为游标查 created_at 更新的 PAGE_SIZE 条，去重后追加到尾部。
  // 若不足一页 → 已追到真·最新 → 切回实时模式(liveTail)、清「N条新消息」、回写缓存。
  const loadNewer = useCallback(async () => {
    if (loadingNewerRef.current || isAtLiveTailRef.current || !myId) return
    const cursor = newestCursorRef.current
    if (!cursor) return
    const a = activeRef.current
    const key = a.kind === "hall" ? "hall" : pairKey(myId, a.id)
    loadingNewerRef.current = true
    try {
      let newer: DisplayMsg[]
      let pageFull: boolean
      if (a.kind === "hall") {
        const { data, error } = await supabase
          .from("chat_messages")
          .select("id,user_id,username,avatar_url,kind,content,created_at")
          .gt("created_at", cursor.created_at)
          .order("created_at", { ascending: true })
          .limit(PAGE_SIZE)
        if (error) return
        const rows = (data ?? []) as ChatRow[]
        pageFull = rows.length >= PAGE_SIZE
        newer = rows.map(mapHall)
      } else {
        const partner: Partner = { id: a.id, username: a.username, avatar_url: a.avatar_url }
        const { data, error } = await supabase
          .from("dm_messages")
          .select("id,sender_id,kind,content,created_at,read_at")
          .eq("pair_key", key)
          .gt("created_at", cursor.created_at)
          .order("created_at", { ascending: true })
          .limit(PAGE_SIZE)
        if (error) return
        const rows = (data ?? []) as DmRow[]
        pageFull = rows.length >= PAGE_SIZE
        newer = rows.map((m) => mapDm(m, myId, myName, partner))
      }
      // 拉取期间切了会话则丢弃
      const cur = activeRef.current
      const curKey = cur.kind === "hall" ? "hall" : pairKey(myId, cur.id)
      if (curKey !== key) return
      const reachedTail = !pageFull // 不足一页=已到最新
      setMessages((prev) => {
        const existing = new Set(prev.map((m) => m.id))
        const merged = [...prev, ...newer.filter((m) => !existing.has(m.id))]
        // 追到真·最新时，这段就等于最新尾数组 → 回写缓存
        if (reachedTail) msgCacheRef.current.set(key, merged)
        return merged
      })
      if (reachedTail) {
        setLiveTail(true)
        setNewWhileAway(0)
      }
    } finally {
      loadingNewerRef.current = false
    }
  }, [myId, myName, setLiveTail])

  // 拉取某会话的「日期索引」进缓存 + 设为当前刻度轨数据（已缓存则直接用）。
  // key="hall" → 查大厅 hall_active_dates()；否则 key 即 pairKey → dm_active_dates(pk)。
  const ensureActiveDates = useCallback(
    async (key: string) => {
      const cached = activeDatesRef.current.get(key)
      if (cached) {
        setActiveDates(cached)
        return
      }
      const { data, error } =
        key === "hall"
          ? await supabase.rpc("hall_active_dates")
          : await supabase.rpc("dm_active_dates", { pk: key })
      if (error || !data) return
      const buckets = (data as { d: string; cnt: number }[]).map((r) => ({ d: r.d, cnt: r.cnt }))
      activeDatesRef.current.set(key, buckets)
      // 落库前再确认仍是当前会话，避免把 A 的日期塞给 B
      const a = activeRef.current
      const curKey = a.kind === "hall" ? "hall" : pairKey(myId ?? "", a.id)
      if (curKey === key) setActiveDates(buckets)
    },
    [myId],
  )

  // 新消息的日期并入刻度轨索引：已有当日则 cnt+1，新日期则前插（新→旧序）。
  const noteActiveDate = useCallback(
    (key: string, iso: string) => {
      const d = cnDate(iso)
      const cur = activeDatesRef.current.get(key) ?? []
      const idx = cur.findIndex((b) => b.d === d)
      let next: DateBucket[]
      if (idx >= 0) {
        next = cur.slice()
        next[idx] = { ...next[idx], cnt: next[idx].cnt + 1 }
      } else {
        next = [{ d, cnt: 1 }, ...cur]
      }
      activeDatesRef.current.set(key, next)
      const a = activeRef.current
      const curKey = a.kind === "hall" ? "hall" : pairKey(myId ?? "", a.id)
      if (curKey === key) setActiveDates(next)
    },
    [myId],
  )

  // 跳转到某天（dateStr=上海当地 "YYYY-MM-DD"）。
  //   已加载 → 直接滚到那天第一条；未加载 → 拉那天窗口替换列表、进窗口模式、滚过去。
  const jumpToDate = useCallback(
    async (dateStr: string) => {
      if (!myId) return
      setActiveDate(dateStr)
      const a = activeRef.current
      const key = a.kind === "hall" ? "hall" : pairKey(myId, a.id)

      // 1) 已在内存：滚到那天第一条
      const scrollToDay = () => {
        const el = feedRef.current
        if (!el) return
        const row = el.querySelector<HTMLElement>(`[data-day="${dateStr}"]`)
        if (row) row.scrollIntoView({ block: "start", behavior: "smooth" })
      }
      const loadedHasDay = messagesRef.current.some((m) => cnDate(m.created_at) === dateStr)
      if (loadedHasDay) {
        scrollToDay()
        return
      }

      // 2) 未加载：拉那天起的一页（升序），替换为窗口、进窗口模式
      const { startUTC } = cnDayRangeUTC(dateStr)
      let win: DisplayMsg[] = []
      if (a.kind === "hall") {
        const { data, error } = await supabase
          .from("chat_messages")
          .select("id,user_id,username,avatar_url,kind,content,created_at")
          .gte("created_at", startUTC)
          .order("created_at", { ascending: true })
          .limit(PAGE_SIZE)
        if (error) return
        win = ((data ?? []) as ChatRow[]).map(mapHall)
      } else {
        const partner: Partner = { id: a.id, username: a.username, avatar_url: a.avatar_url }
        const { data, error } = await supabase
          .from("dm_messages")
          .select("id,sender_id,kind,content,created_at,read_at")
          .eq("pair_key", key)
          .gte("created_at", startUTC)
          .order("created_at", { ascending: true })
          .limit(PAGE_SIZE)
        if (error) return
        win = ((data ?? []) as DmRow[]).map((m) => mapDm(m, myId, myName, partner))
      }
      // 切会话守卫
      const cur = activeRef.current
      const curKey = cur.kind === "hall" ? "hall" : pairKey(myId, cur.id)
      if (curKey !== key) return
      if (win.length === 0) return
      // 窗口末尾是否已是真·最新：不足一页说明从该天到现在的消息都拿全了 → 仍是 live
      const reachedTail = win.length < PAGE_SIZE
      hasMoreRef.current = true // 窗口上方一定还有更早（该天恰为最早时，loadOlder 空查会自纠）
      setLiveTail(reachedTail)
      setNewWhileAway(0)
      setMessages(win)
      // 渲染后滚到那天第一条
      requestAnimationFrame(() => requestAnimationFrame(scrollToDay))
    },
    [myId, myName, setLiveTail],
  )

  // 回到最新：重拉最新一页、替换列表、切回实时模式、滚到底、清提示。
  const returnToLatest = useCallback(async () => {
    if (!myId) return
    const a = activeRef.current
    const key = a.kind === "hall" ? "hall" : pairKey(myId, a.id)
    let latest: DisplayMsg[] = []
    if (a.kind === "hall") {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id,user_id,username,avatar_url,kind,content,created_at")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE)
      if (error) return
      latest = ((data ?? []) as ChatRow[]).slice().reverse().map(mapHall)
    } else {
      const partner: Partner = { id: a.id, username: a.username, avatar_url: a.avatar_url }
      const { data, error } = await supabase
        .from("dm_messages")
        .select("id,sender_id,kind,content,created_at,read_at")
        .eq("pair_key", key)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE)
      if (error) return
      latest = ((data ?? []) as DmRow[]).slice().reverse().map((m) => mapDm(m, myId, myName, partner))
    }
    const cur = activeRef.current
    const curKey = cur.kind === "hall" ? "hall" : pairKey(myId, cur.id)
    if (curKey !== key) return
    hasMoreRef.current = latest.length >= PAGE_SIZE
    msgCacheRef.current.set(key, latest)
    setLiveTail(true)
    setNewWhileAway(0)
    setActiveDate(latest.length ? cnDate(latest[latest.length - 1].created_at) : null)
    setMessages(latest)
    atBottomRef.current = true
    requestAnimationFrame(() => {
      const el = feedRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [myId, myName, setLiveTail])

  // 算刻度轨高亮日期：取读线（feed 顶部）处第一条仍在视口内的消息的 data-day。
  // 一次性 O(n) DOM 读，由 onScroll 去抖到停滚后调用。
  const computeActiveDate = useCallback(() => {
    const el = feedRef.current
    if (!el) return
    const top = el.getBoundingClientRect().top
    const rows = el.querySelectorAll<HTMLElement>("[data-day]")
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].getBoundingClientRect().bottom >= top + 8) {
        const d = rows[i].getAttribute("data-day")
        if (d) setActiveDate(d)
        return
      }
    }
  }, [])

  // 切换刻度轨展开/收起（私聊+大厅通用）。打开时才懒拉日期索引 + 按当前滚动位置定高亮，
  // 用户不点就一次 RPC 都不发。
  const toggleRail = () => {
    const next = !railOpen
    setRailOpen(next)
    if (next) {
      const a = activeRef.current
      const key = a.kind === "hall" ? "hall" : pairKey(myId ?? "", a.id)
      void ensureActiveDates(key)
      requestAnimationFrame(computeActiveDate)
    }
  }

  // 贴底才自动滚（看历史不被打断）
  const onScroll = () => {
    const el = feedRef.current
    if (!el) return
    const distToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    atBottomRef.current = distToBottom < 60
    // 滚到顶部附近 → 加载更早历史（并发/无更多/切会话由 loadOlder 内部判定，重复触发安全）
    if (el.scrollTop < 120) void loadOlder()
    // 窗口模式下滑到底部附近 → 加载更新的一页（正常模式靠实时，不触发）
    if (distToBottom < 200 && !isAtLiveTailRef.current) void loadNewer()
    // 停滚后算刻度轨高亮（仅轨道展开时才算；去抖，避免每帧 O(n) DOM 读）
    if (railOpen) {
      if (scrollIdleRef.current) clearTimeout(scrollIdleRef.current)
      scrollIdleRef.current = setTimeout(computeActiveDate, 140)
    }
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

  // 游标同步：分别指向已加载的最老一条([0])与最新一条([末])。messages 升序。
  // loadOlder 用 oldest 往更早翻；loadNewer（窗口模式下滑）用 newest 往更新翻。
  useEffect(() => {
    messagesRef.current = messages
    oldestCursorRef.current = messages.length
      ? { created_at: messages[0].created_at, id: messages[0].id }
      : null
    newestCursorRef.current = messages.length
      ? { created_at: messages[messages.length - 1].created_at, id: messages[messages.length - 1].id }
      : null
  }, [messages])

  // 前插历史的滚动锚定：在浏览器绘制前把 scrollTop 往下补偿「新增内容的高度」，
  // 让用户视线停在原来那条消息上，不会因为顶部插入而跳动。仅在 loadOlder 设了锚点时生效。
  useIsoLayoutEffect(() => {
    const anchor = pendingAnchorRef.current
    if (!anchor) return
    pendingAnchorRef.current = null
    const el = feedRef.current
    if (el) el.scrollTop = anchor.prevTop + (el.scrollHeight - anchor.prevHeight)
  }, [messages])

  // 打开面板 / 切换会话时无条件贴底。
  // 原本只依赖 atBottomRef（贴底才自动滚），但「打开」那一刻 feedRef 还在
  // AnimatePresence 入场动画中、尺寸未定；随后消息异步到达时 scrollTop=scrollHeight
  // 可能落在面板尚未撑满高度之前 → 实际停在顶部。这里在 open/active 变化后延后到
  // 布局稳定再强制滚底，覆盖该竞态。
  useEffect(() => {
    if (!open) return
    const jump = () => {
      const el = feedRef.current
      if (el) el.scrollTop = el.scrollHeight
    }
    atBottomRef.current = true
    jump()
    requestAnimationFrame(jump)
    requestAnimationFrame(() => requestAnimationFrame(jump))
  }, [open, active])

  const send = useCallback(
    async (kind: "text" | "sticker", content: string) => {
      if (!user || sending) return
      const text = content.trim()
      if (!text) return
      // 懒触发邮箱验证：未验证 → 弹验证窗并中止本次发送（DB 触发器仍兜底），
      // 与发帖/发弹幕入口一致；否则未验证用户在聊天里只会看到裸的发送失败。
      if (guardVerify()) return
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
          // 未验证邮箱（DB 兜底）：弹验证窗而非裸的「发送失败」。
          // 正常情况下提交前 guardVerify() 已拦，这里是防标志过期/竞态的兜底。
          const msg = (error as { message?: string }).message || ""
          const unverified =
            /EMAIL_UNVERIFIED/i.test(msg) ||
            (error as { code?: string }).code === "23514"
          if (unverified) {
            openVerifyGate()
            return
          }
          const rl = (error as { code?: string }).code === "42501" || /row-level security/i.test(msg)
          toast({
            title: rl ? "发太快了" : "发送失败",
            description: rl ? "慢一点～3 秒最多 3 条" : msg || "请稍后再试",
            variant: "destructive",
          })
        } else if (a.kind === "dm" && a.id === MENGMEGZI_USER_ID) {
          // 私聊对象是萌萌子：触发独立模型异步回复（fire-and-forget，失败静默）。
          // 文本和表情包都触发；表情包的 content 是情绪 id，后端会转成心情描述进上下文。
          // 她的回复经 dm 实时订阅自动出现在会话里，这里无需处理返回值。
          ;(async () => {
            try {
              const { data: s } = await supabase.auth.getSession()
              const tok = s?.session?.access_token
              if (!tok) return
              await fetch(apiUrl("/api/hanako-dm"), {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
                body: JSON.stringify({ content: text, kind }),
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

  // @ 补全：把光标前最近的「词首 @」之后的内容替换成 萌萌子+空格，光标跟到补全末尾。
  // 仅大厅用。补全后关闭菜单、聚焦输入框、重算高度。
  const completeMention = () => {
    const ta = textareaRef.current
    if (!ta) return
    const v = input
    const pos = ta.selectionStart ?? v.length
    const before = v.slice(0, pos)
    // 复用 onChange 的同一套「词首 @」判定，找到要替换的 @ 位置
    let atIdx = -1
    for (let i = before.length - 1; i >= 0; i--) {
      if (before[i] === " ") break
      if (before[i] === "@") {
        const prev = before[i - 1]
        if (prev === undefined || prev === " " || prev === "\n") atIdx = i
        break
      }
    }
    if (atIdx < 0) return
    const insert = "萌萌子 "
    const next = v.slice(0, atIdx + 1) + insert + v.slice(pos)
    setInput(next.slice(0, MAX_LEN))
    setMentionOpen(false)
    // 光标放到补全词之后（@萌萌子 的空格后）
    const caret = atIdx + 1 + insert.length
    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(caret, caret)
      autoResize(textareaRef.current)
    })
  }

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
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  className={styles.headerClose}
                  onClick={toggleRail}
                  aria-label="日期时间线"
                  title="日期时间线"
                  style={railOpen ? { color: "#a3e635" } : undefined}
                >
                  <CalendarDays className="h-5 w-5" />
                </button>
                <button className={styles.headerClose} onClick={() => setOpen(false)} aria-label="关闭">
                  <X className="h-5 w-5" />
                </button>
              </div>
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

            <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div ref={feedRef} className={styles.feed} onScroll={onScroll}>
              {messages.length === 0 ? (
                <div className={styles.empty}>
                  {active.kind === "hall" ? "还没有人说话，来打个招呼吧～" : `和 ${active.username} 开始聊天吧～`}
                </div>
              ) : (
                messages.map((m) => {
                  const mine = m.fromId === user.id
                  return (
                    <div key={m.id} data-day={cnDate(m.created_at)} className={`${styles.row} ${mine ? styles.rowMine : styles.rowOther} ${m.isNew ? styles.rowNew : ""}`}>
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
                            base={`/hanako/stickers/${normalizeEmotion(m.content)}`}
                            className={styles.msgSticker}
                            onClick={(src) => setLightboxSrc(src)}
                          />
                        ) : (
                          <div className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleOther}`}>{m.content}</div>
                        )}
                        {/* 自己发的文本消息、对方已读 → 显示「已读」小字（贴右下） */}
                        {mine && active.kind === "dm" && m.read_at && m.kind === "text" && (
                          <span className={styles.readMark}>已读</span>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>

              {/* 日期刻度轨（点 header 按钮才展开；私聊+大厅通用；少于2个日期时组件内部自不渲染） */}
              {railOpen && (
                <ChatDateRail dates={activeDates} activeDate={activeDate} onJump={jumpToDate} />
              )}

              {/* 窗口模式（看历史时）：右下角「回到最新」；期间来了新消息则提示条数 */}
              {!atLiveTail && (
                <button
                  type="button"
                  onClick={() => void returnToLatest()}
                  className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/20 bg-neutral-900/85 px-3.5 py-1.5 text-[12px] text-white shadow-[0_8px_24px_rgba(0,0,0,0.5)] transition-transform hover:scale-105"
                >
                  {newWhileAway > 0 ? `${newWhileAway} 条新消息 ↓` : "回到最新 ↓"}
                </button>
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
              <AnimatePresence>
                {mentionOpen && (
                  <motion.div
                    className={styles.mentionMenu}
                    initial={{ opacity: 0, y: 6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.96 }}
                    transition={{ duration: 0.12 }}
                  >
                    <button
                      className={styles.mentionItem}
                      onMouseDown={(e) => {
                        // 用 mousedown 而非 click：避免先触发 textarea blur 导致光标位置丢失
                        e.preventDefault()
                        completeMention()
                      }}
                    >
                      <UserAvatar username={HANAKO_DM_USERNAME} avatarUrl={HANAKO_AVATAR} size={22} />
                      <span>{HANAKO_DM_USERNAME}</span>
                      <span className={styles.mentionHint}>回车选择</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
              <button className={styles.iconBtn} onClick={() => setShowStickers((s) => !s)} aria-label="表情包">
                <Smile className="h-5 w-5" />
              </button>
              <textarea
                ref={textareaRef}
                className={styles.input}
                value={input}
                rows={1}
                onChange={(e) => {
                  const v = e.target.value.slice(0, MAX_LEN)
                  setInput(v)
                  autoResize(e.currentTarget)
                  // @ 补全：仅大厅场景。检测光标前文本里「词首 @」且 @ 后无空格 → 弹菜单。
                  // 词首 = @ 前是空格/行首/串首。@ 后一旦敲了空格即关闭（视为放弃补全）。
                  if (active.kind === "hall") {
                    const pos = e.target.selectionStart ?? v.length
                    const before = v.slice(0, pos)
                    // 找最后一个未被空格打断的 @
                    const atIdx = (() => {
                      for (let i = before.length - 1; i >= 0; i--) {
                        if (before[i] === " ") return -1 // 遇空格停止：当前词不含 @
                        if (before[i] === "@") {
                          // @ 必须在词首：前一个字符是空格/行首/串首
                          const prev = before[i - 1]
                          return prev === undefined || prev === " " || prev === "\n" ? i : -1
                        }
                      }
                      return -1
                    })()
                    setMentionOpen(atIdx >= 0)
                  } else {
                    setMentionOpen(false)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    // 菜单开着时回车=选中补全，而非发送
                    if (mentionOpen) {
                      completeMention()
                    } else {
                      submitText()
                      setMentionOpen(false)
                    }
                  } else if (e.key === "Escape" && mentionOpen) {
                    e.preventDefault()
                    setMentionOpen(false)
                  }
                }}
                placeholder={active.kind === "hall" ? "对大厅说点什么…" : `私聊 ${active.username}…`}
                maxLength={MAX_LEN}
                onBlur={() => setMentionOpen(false)}
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
  created_at: string
}
interface DmRow {
  id: string
  sender_id: string
  kind: "text" | "sticker"
  content: string
  created_at: string
  read_at?: string | null
}

function mapHall(m: ChatRow): DisplayMsg {
  // 萌萌子的 profiles 行可能脏（撞名后缀/无头像），她在大厅发言一律用固定名字/头像，
  // 与在线列表、私信、弹窗三处保持一致。
  const isHanako = m.user_id === MENGMEGZI_USER_ID
  return {
    id: m.id,
    fromId: m.user_id,
    username: isHanako ? HANAKO_DM_USERNAME : m.username,
    avatar_url: isHanako ? HANAKO_AVATAR : m.avatar_url,
    kind: m.kind,
    content: m.content,
    created_at: m.created_at,
  }
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
    created_at: m.created_at,
    read_at: m.read_at ?? null,
  }
}

// 合并两组展示消息：按 id 去重、按 created_at 升序。
// 用于「缓存命中后台再拉最新一页」时，把新到的消息并入已加载列表（可能已上翻出更早历史），
// 既不丢历史、也不打乱顺序；对已存在的消息补一次 read_at（已读回执可能在期间更新）。
function mergeMsgs(prev: DisplayMsg[], incoming: DisplayMsg[]): DisplayMsg[] {
  const byId = new Map<string, DisplayMsg>()
  for (const m of prev) byId.set(m.id, m)
  for (const m of incoming) {
    const ex = byId.get(m.id)
    if (ex) {
      if (!ex.read_at && m.read_at) byId.set(m.id, { ...ex, read_at: m.read_at })
    } else {
      byId.set(m.id, m)
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  )
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
