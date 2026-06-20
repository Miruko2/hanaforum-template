"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { X } from "lucide-react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useNotifications } from "@/contexts/notification-context"
import { useChatUI } from "@/contexts/chat-ui-context"
import { cdnUrl } from "@/lib/cdn-url"
import { supabase } from "@/lib/supabaseClient"
import { getAnnouncement, getPost, likePost, unlikePost, checkUserLiked } from "@/lib/supabase"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import { MENGMEGZI_USER_ID, HANAKO_DM_USERNAME, HANAKO_AVATAR } from "@/lib/hanako/constants"
import AnnouncementModal from "@/components/announcement-modal"
import PostDetailModal from "@/components/post-detail-modal"
import { useRouter } from "next/navigation"
import type { Notification, Post } from "@/lib/types"

/**
 * 通用通知顶部弹窗（仿 macOS 通知，纵向堆叠）。
 *
 * 由 announcement-popup（仅公告单条）升级而来：
 *   - 公开通知：数据源 useNotifications()，所有类型都弹；
 *   - 私信：独立订阅 dm_messages realtime（与公开通知是两套系统，私信不入 notifications 表），
 *     收到私信也弹同一个窗；面板开着时一概不弹（用户正在看）；
 *   - 多条以纵向堆叠形式出现，新通知从顶部滑入、旧的往下推，最多同时显示 MAX_VISIBLE 条；
 *   - 点击主体：公开通知按类型复刻铃铛行为；私信 → startDmWith 打开聊天跳到该对话。
 *
 * 「已弹过」用 per-user localStorage 的 id 集合记录，与铃铛 is_read 解耦：
 * 铃铛一打开就会把所有通知 markAllAsRead，若用 is_read 判定是否弹窗会彻底失效。
 * 离线收到的公开通知：NotificationProvider 登入即拉取列表 → 候选 effect 自动覆盖；
 * 离线私信：realtime 只推「在线期间」的新消息，离线时收到的私信在下次打开聊天时
 *   由 floating-chat 累积为未读红点，不在此弹窗补弹（私信的「离线补弹」语义不同于公告）。
 *
 * 数据上的取舍：
 *   - 非公告类公开通知自带 message / actor，零额外请求；
 *   - 公告类通知 message 仅是预览，进队列时先用 message 占位，后台 getAnnouncement 回填标题/内容；
 *   - 私信 realtime 只带 sender_id，先占位弹（名字「用户」），后台查 profiles 回填头像/名字。
 */

// 自动消失时长（毫秒）。圆环视觉与此同步。
const AUTO_DISMISS_MS = 20000
// 同时最多可见条数；超出时最老的淡出。
const MAX_VISIBLE = 5
// 同一发送者的私信在队列里最多并存条数；超出时该 sender 最老的一条让位（不标记 popped）。
const MAX_PER_SENDER = 3
// 后台补漏窗口：页面从隐藏→可见时，回查这段时间内收到的私信。
// 取 25 分钟：覆盖「切到别的标签/窗口一会再回来」的常见时长。
const BACKFILL_WINDOW_MS = 25 * 60 * 1000
// poppedSet 容量上限，防 localStorage 无限增长（保留最近 POPPED_CAP 个 id）。
const POPPED_CAP = 200

// 倒计时圆环几何
const RING_R = 12
const RING_C = 2 * Math.PI * RING_R

const poppedKey = (uid: string) => `firefly:notif-popped:${uid}`

// 卡片展示用的解析结果：提取 logo / eyebrow / title / body，及回填标志。
interface CardView {
  logoUrl: string
  eyebrow: string
  title: string
  body: string
  // 公告类需要二次请求回填完整标题/内容（占位用 message）
  needAnnouncementFill: boolean
  // 私信类需要查 profiles 回填发送者头像/名字（占位用「用户」/logo）
  needProfileFill: boolean
}

// 私信队列项：来自 dm_messages realtime 的轻量记录（私信不入 notifications 表）。
interface DmItem {
  kind: "dm"
  // 用 dm 消息的 id 作为队列 key；与 Notification.id 命名空间不冲突（uuid）
  id: string
  senderId: string
  content: string
  created_at: string
}

// 统一队列项：公开通知或私信，用 kind 判别；堆叠渲染与计时逻辑不关心来源。
type QueueItem = (Notification & { kind: "notif" }) | DmItem

function viewOf(n: Notification): CardView {
  const actorName = n.actor?.username || "某人"
  const actorAvatar = (n.actor?.avatar_url ? cdnUrl(n.actor.avatar_url) : null) || "/logo.png"
  switch (n.type) {
    case "announcement":
      return {
        logoUrl: "/logo.png",
        eyebrow: "系统公告 · 萤火虫之国",
        title: "公告",
        body: n.message || "",
        needAnnouncementFill: true,
        needProfileFill: false,
      }
    case "like_post":
    case "like_comment":
      return {
        logoUrl: actorAvatar,
        eyebrow: "点赞通知",
        title: `${actorName} 赞了你`,
        body: n.message || "",
        needAnnouncementFill: false,
        needProfileFill: false,
      }
    case "comment_post":
      return {
        logoUrl: actorAvatar,
        eyebrow: "评论通知",
        title: `${actorName} 评论了你`,
        body: n.message || "",
        needAnnouncementFill: false,
        needProfileFill: false,
      }
    case "follow":
      return {
        logoUrl: actorAvatar,
        eyebrow: "关注通知",
        title: `${actorName} 关注了你`,
        body: n.message || "",
        needAnnouncementFill: false,
        needProfileFill: false,
      }
    case "chat_mention":
      return {
        logoUrl: actorAvatar,
        eyebrow: "聊天提及",
        title: `${actorName} 在大厅提到了你`,
        body: n.message || "",
        needAnnouncementFill: false,
        needProfileFill: false,
      }
    case "post_removed":
      return {
        logoUrl: "/logo.png",
        eyebrow: "系统通知",
        title: "你的帖子被移除",
        body: n.message || "",
        needAnnouncementFill: false,
        needProfileFill: false,
      }
    default:
      return {
        logoUrl: actorAvatar,
        eyebrow: "通知",
        title: actorName,
        body: n.message || "",
        needAnnouncementFill: false,
        needProfileFill: false,
      }
  }
}

// 私信卡片的占位视图：realtime 只带 sender_id，先占位（名字「用户」/logo），
// needProfileFill=true 触发后台查 profiles 回填头像/名字。
// 私信AI 例外：占位阶段就用固定名/头像，不闪「用户」+logo，也不必查 profiles。
function viewOfDm(dm: DmItem): CardView {
  const isHanako = dm.senderId === MENGMEGZI_USER_ID
  return {
    logoUrl: isHanako ? HANAKO_AVATAR : "/logo.png",
    eyebrow: "私信",
    title: isHanako ? HANAKO_DM_USERNAME : "用户",
    body: dm.content,
    needAnnouncementFill: false,
    needProfileFill: !isHanako,
  }
}

function isNotif(item: QueueItem): item is Notification & { kind: "notif" } {
  return item.kind === "notif"
}

// 安卓等弱合成器：去 backdrop-filter，改近实底深色底。
function detectAndroid(): boolean {
  return typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
}

export default function AnnouncementPopup() {
  const { user, isAdmin } = useSimpleAuth()
  const { notifications, markAsRead } = useNotifications()
  const { open: chatOpen, startDmWith, openHall } = useChatUI()
  const { toast } = useToast()
  const isMobile = useIsMobile()
  const router = useRouter()

  // 当前在显的通知队列（公开通知 + 私信，最多 MAX_VISIBLE 条）
  const [queue, setQueue] = useState<QueueItem[]>([])
  // 每条卡片的展示视图（公告/私信回填后更新对应条目）
  const [views, setViews] = useState<Record<string, CardView>>({})
  // 私信发送者的资料回填缓存：senderId → { username, avatar_url }，点击跳转时复用
  const dmProfileRef = useRef<Map<string, { username: string; avatar_url?: string | null }>>(new Map())
  // chatOpen 的 ref 镜像：realtime 回调里读取，避免 chatOpen 变化导致重订阅
  const chatOpenRef = useRef(chatOpen)
  useEffect(() => {
    chatOpenRef.current = chatOpen
  }, [chatOpen])

  const [isAndroid] = useState(detectAndroid)
  // 入场动画跑完再开毛玻璃，避免 spring 期间每帧重采样模糊（安卓掉帧主因）
  const [glassReady, setGlassReady] = useState(false)

  // poppedSet 内存副本（Notification id 集合），决定哪些通知已弹过、不再候选
  const poppedRef = useRef<Set<string>>(new Set())

  // 帖子详情 / 公告全文 Modal（点击主体时复刻铃铛行为）
  const [activePost, setActivePost] = useState<Post | null>(null)
  const [activeAnnouncement, setActiveAnnouncement] = useState<{
    title: string
    content: string
    created_at: string
  } | null>(null)
  const [modalLiked, setModalLiked] = useState(false)
  const [modalLikeCount, setModalLikeCount] = useState(0)
  const [modalIsLiking, setModalIsLiking] = useState(false)
  const [loadingPostId, setLoadingPostId] = useState<string | null>(null)

  // 写入 poppedSet（内存 + localStorage，带容量上限）
  const markPopped = (id: string) => {
    const s = poppedRef.current
    if (s.has(id)) return
    s.add(id)
    if (typeof window === "undefined" || !user) return
    try {
      // 保留最近 POPPED_CAP 个：与当前 notifications 取交集 + 新增，避免集合膨胀
      const arr = Array.from(s)
      const trimmed = arr.slice(Math.max(0, arr.length - POPPED_CAP))
      poppedRef.current = new Set(trimmed)
      localStorage.setItem(poppedKey(user.id), JSON.stringify(trimmed))
    } catch {
      // localStorage 不可用时忽略（无痕模式 / 配额）
    }
  }

  // 用户切换：加载该用户的 poppedSet 基线；登出时清空队列
  useEffect(() => {
    if (!user) {
      poppedRef.current = new Set()
      setQueue([])
      setViews({})
      setActivePost(null)
      setActiveAnnouncement(null)
      return
    }
    try {
      const raw = localStorage.getItem(poppedKey(user.id))
      poppedRef.current = new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch {
      poppedRef.current = new Set()
    }
    // 切用户时清空旧队列，避免上一个用户的通知残留
    setQueue([])
    setViews({})
  }, [user?.id])

  // 候选选择：每当 notifications 变化，把「未弹过」的新公开通知补进队列，截断到 MAX_VISIBLE。
  // 实时到达（realtime 推新）与离线补弹（登入首次拉取填充列表）都走这一条 effect。
  useEffect(() => {
    if (!user) return
    const popped = poppedRef.current
    const candidates = notifications
      .filter((n) => !popped.has(n.id))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .map((n): QueueItem => ({ ...n, kind: "notif" }))

    setQueue((prev) => {
      const inQueue = new Set(prev.map((n) => n.id))
      const fresh = candidates.filter((n) => !inQueue.has(n.id))
      if (fresh.length === 0) return prev
      // 新的排在前面（顶部滑入），与旧的合并后截断；被截掉的最老条目标记 popped，防止下次重复候选
      const merged = [...fresh, ...prev]
      const visible = merged.slice(0, MAX_VISIBLE)
      const evicted = merged.slice(MAX_VISIBLE)
      evicted.forEach((n) => markPopped(n.id))
      return visible
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications, user])

  // 私信实时订阅：收到发给我的新私信 → 若聊天面板未开 → 推进同一队列。
  // 面板开着时一概不弹（用户正在看聊天）。频道名加后缀避免与 floating-chat 的 dm_incoming 冲突。
  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel("dm_incoming_popup")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_messages", filter: `recipient_id=eq.${user.id}` },
        (payload) => {
          // 面板开着：不弹（用户正在看聊天）
          if (chatOpenRef.current) return
          const m = payload.new as { id: string; sender_id: string; content: string; created_at: string }
          if (poppedRef.current.has(m.id)) return // 已弹过
          const dm: DmItem = {
            kind: "dm",
            id: m.id,
            senderId: m.sender_id,
            content: m.content,
            created_at: m.created_at,
          }
          setQueue((prev) => {
            if (prev.some((it) => it.id === dm.id)) return prev
            // 同一发送者在队列里最多 MAX_PER_SENDER 条：超出时把该 sender 最老的一条移出
            // 让位给新的。被移出的「不」标记 popped——realtime 事件是一次性的，移除后不会再
            // 被推回，因此既不占队列、也不会重复弹；保留它在新消息里被看到的可能。
            const sameSender = prev.filter((it) => it.kind === "dm" && it.senderId === dm.senderId)
            let next = prev
            if (sameSender.length >= MAX_PER_SENDER) {
              // 找该 sender 在队列里最老的一条（created_at 最小）移除
              const oldest = sameSender.sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
              )[0]
              next = prev.filter((it) => it.id !== oldest.id)
            }
            const merged = [dm, ...next]
            const visible = merged.slice(0, MAX_VISIBLE)
            const evicted = merged.slice(MAX_VISIBLE)
            // 仅因总条数超上限被挤出队列的才标记 popped（防公开通知候选 effect 再扫回来）；
            // 因 per-sender 上限被移除的上面已处理，不在此标记。
            evicted.forEach((it) => markPopped(it.id))
            return visible
          })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // 后台补漏：页面从隐藏→可见时，查询近期收到的私信，把后台节流期间漏掉的 realtime
  // 事件补弹。背景：浏览器在后台会节流 WebSocket 心跳，dm_incoming_popup 订阅可能因此
  // 漏掉事件（floating-chat 的 dm_incoming 挂载更早、订阅更稳，所以红点仍能亮）。
  // 补漏只覆盖 BACKFILL_WINDOW_MS 内的消息，用 poppedSet 过滤已弹过的。
  useEffect(() => {
    if (!user) return
    let lastVisible = document.visibilityState === "visible"
    const onVisibility = () => {
      const nowVisible = document.visibilityState === "visible"
      if (!nowVisible || lastVisible) {
        lastVisible = nowVisible
        return
      }
      lastVisible = true
      // 面板开着：不补（用户正在看聊天）
      if (chatOpenRef.current) return
      // 查近期收到的私信
      const since = new Date(Date.now() - BACKFILL_WINDOW_MS).toISOString()
      supabase
        .from("dm_messages")
        .select("id,sender_id,content,created_at")
        .eq("recipient_id", user.id)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(20)
        .then(({ data }) => {
          if (!data) return
          const popped = poppedRef.current
          const fresh = (data as { id: string; sender_id: string; content: string; created_at: string }[])
            .filter((m) => !popped.has(m.id))
            .map((m): DmItem => ({
              kind: "dm",
              id: m.id,
              senderId: m.sender_id,
              content: m.content,
              created_at: m.created_at,
            }))
          if (fresh.length === 0) return
          setQueue((prev) => {
            const inQueue = new Set(prev.map((it) => it.id))
            const toAdd = fresh.filter((d) => !inQueue.has(d.id))
            if (toAdd.length === 0) return prev
            // 倒序追加（最新的在前），按 MAX_PER_SENDER 给每个 sender 限流：
            // 队列里同一 sender 超过上限则移除其中最老的，被移除的不标记 popped。
            let merged = [...toAdd, ...prev]
            const perSender = new Map<string, number>()
            merged = merged.filter((it) => {
              if (it.kind !== "dm") return true
              const n = (perSender.get(it.senderId) ?? 0) + 1
              perSender.set(it.senderId, n)
              return n <= MAX_PER_SENDER
            })
            const visible = merged.slice(0, MAX_VISIBLE)
            const evicted = merged.slice(MAX_VISIBLE)
            evicted.forEach((it) => markPopped(it.id))
            return visible
          })
        })
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // 异步回填：公告 → getAnnouncement 补全标题/内容；私信 → 批量查 profiles 补全头像/名字。
  useEffect(() => {
    let cancelled = false
    const fill = async () => {
      // 私信：先收集所有需要回填的 senderId，一次 profiles 查询批量补全
      const dmNeed = queue.filter(
        (it): it is DmItem => it.kind === "dm" && (views[it.id] ?? viewOfDm(it)).needProfileFill,
      )
      if (dmNeed.length > 0) {
        const senderIds = Array.from(new Set(dmNeed.map((d) => d.senderId))).filter(
          (id) => !dmProfileRef.current.has(id),
        )
        if (senderIds.length > 0) {
          try {
            const { data: profs } = await supabase
              .from("profiles")
              .select("id,username,avatar_url")
              .in("id", senderIds)
            if (!cancelled && profs) {
              for (const p of profs as { id: string; username: string; avatar_url: string | null }[]) {
                dmProfileRef.current.set(p.id, { username: p.username, avatar_url: p.avatar_url })
              }
            }
          } catch {
            // 回填失败保留占位（「用户」/logo），不阻断展示
          }
        }
        for (const d of dmNeed) {
          if (cancelled) break
          // 私信AI 用固定展示名/头像（profiles 行可能脏：撞名后缀 + 无头像），
          // 不读查询结果，与私信面板保持一致。
          if (d.senderId === MENGMEGZI_USER_ID) {
            setViews((prev) => {
              const base = prev[d.id] ?? viewOfDm(d)
              return {
                ...prev,
                [d.id]: { ...base, logoUrl: HANAKO_AVATAR, title: HANAKO_DM_USERNAME, needProfileFill: false },
              }
            })
            continue
          }
          const prof = dmProfileRef.current.get(d.senderId)
          if (!prof) continue
          setViews((prev) => {
            const base = prev[d.id] ?? viewOfDm(d)
            return {
              ...prev,
              [d.id]: {
                ...base,
                logoUrl: (prof.avatar_url ? cdnUrl(prof.avatar_url) : null) || "/logo.png",
                title: prof.username || base.title,
                needProfileFill: false,
              },
            }
          })
        }
      }

      // 公告：逐条 getAnnouncement 回填
      for (const it of queue) {
        if (it.kind !== "notif") continue
        const n = it
        const v = views[n.id] ?? viewOf(n)
        if (!v.needAnnouncementFill) continue
        if (!n.announcement_id) continue
        try {
          const ann = await getAnnouncement(n.announcement_id)
          if (cancelled || !ann) continue
          setViews((prev) => ({
            ...prev,
            [n.id]: {
              ...v,
              title: ann.title || v.title,
              body: ann.content || v.body,
              needAnnouncementFill: false,
              needProfileFill: false,
            },
          }))
        } catch {
          // 回填失败保留占位（message），不阻断展示
        }
      }
    }
    fill()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue])

  // 入场后开毛玻璃
  useEffect(() => {
    if (queue.length > 0) {
      const t = window.setTimeout(() => setGlassReady(true), 240)
      return () => window.clearTimeout(t)
    }
    setGlassReady(false)
  }, [queue.length > 0])

  // 关闭单条（X / 自动消失）：仅标记 popped + 移出队列，不 markAsRead（与铃铛 unread 解耦）
  const dismissOne = (id: string) => {
    markPopped(id)
    setQueue((prev) => prev.filter((n) => n.id !== id))
    setViews((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  // 点击主体：私信 → startDmWith 打开聊天跳到该对话；公开通知 → 复刻铃铛 handleNotificationClick。
  const handleClick = async (item: QueueItem) => {
    try {
      dismissOne(item.id)

      // 私信：打开聊天面板并跳到该发送者的对话（资料用回填缓存，缺则用占位）
      if (item.kind === "dm") {
        const prof = dmProfileRef.current.get(item.senderId)
        startDmWith({
          id: item.senderId,
          username: prof?.username ?? "用户",
          avatar_url: prof?.avatar_url ?? null,
        })
        return
      }

      // 公开通知：标记已读 + 按类型复刻铃铛
      const n = item
      if (!n.is_read) markAsRead(n.id)

      // 聊天提及：打开聊天面板并切到大厅（@提及/引用都发生在大厅）
      if (n.type === "chat_mention") {
        openHall()
        return
      }

      if (n.type === "announcement") {
        if (!n.announcement_id) return
        setLoadingPostId(n.id)
        try {
          const ann = await getAnnouncement(n.announcement_id)
          if (ann) setActiveAnnouncement(ann)
        } finally {
          setLoadingPostId(null)
        }
        return
      }

      if (!n.post_id) {
        if (n.type === "follow" && n.actor_id) {
          router.push(`/user?id=${n.actor_id}`)
          return
        }
        return
      }

      setLoadingPostId(n.id)
      const post = await getPost(n.post_id)
      let userLiked = false
      if (user) {
        try {
          userLiked = !!(await checkUserLiked(post.id, user.id))
        } catch {
          // 点赞状态不是致命错误
        }
      }
      setActivePost(post as Post)
      setModalLiked(userLiked)
      setModalLikeCount((post as Post).likes_count ?? 0)
    } catch (err: any) {
      console.error("从通知弹窗打开详情失败:", err)
      if (err?.message?.includes("不存在") || err?.code === "PGRST116") {
        toast({ title: "帖子已被删除", description: "该通知对应的帖子不存在", variant: "destructive" })
        if (isNotif(item) && !item.is_read) markAsRead(item.id)
      } else {
        toast({ title: "加载失败", description: "暂时无法加载帖子详情", variant: "destructive" })
      }
    } finally {
      setLoadingPostId(null)
    }
  }

  // 帖子详情 Modal 内点赞（复刻铃铛）
  const handleModalLike = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user || !activePost || modalIsLiking) return
    try {
      setModalIsLiking(true)
      const newLiked = !modalLiked
      const newCount = newLiked ? modalLikeCount + 1 : modalLikeCount - 1
      setModalLiked(newLiked)
      setModalLikeCount(newCount)
      if (newLiked) await likePost(activePost.id, user.id)
      else await unlikePost(activePost.id, user.id)
    } catch {
      setModalLiked(modalLiked)
      setModalLikeCount(modalLikeCount)
    } finally {
      setModalIsLiking(false)
    }
  }

  if (typeof document === "undefined") return null

  const useGlass = glassReady && !isAndroid

  const popup = (
    <div className="ann-pop-root">
      <style>{POPUP_CSS}</style>
      <AnimatePresence mode="popLayout">
        {queue.map((item) => {
          const view = views[item.id] ?? (isNotif(item) ? viewOf(item) : viewOfDm(item))
          return (
            <PopupCard
              key={item.id}
              item={item}
              view={view}
              useGlass={useGlass}
              onDismiss={dismissOne}
              onClick={handleClick}
            />
          )
        })}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      {createPortal(popup, document.body)}

      {/* 点击点赞/评论类通知 → 帖子详情 */}
      {activePost && (
        <PostDetailModal
          post={activePost}
          isOpen={!!activePost}
          onClose={() => setActivePost(null)}
          onLike={handleModalLike}
          onCommentAdded={() => {}}
          liked={modalLiked}
          likeCount={modalLikeCount}
          isLiking={modalIsLiking}
          username={activePost.username ?? "匿名"}
          avatarUrl={activePost.users?.avatar_url ?? null}
          isMobile={isMobile}
          isAdmin={isAdmin}
        />
      )}

      {/* 点击公告通知 → 全文 */}
      <AnnouncementModal
        isOpen={!!activeAnnouncement}
        onClose={() => setActiveAnnouncement(null)}
        title={activeAnnouncement?.title ?? null}
        content={activeAnnouncement?.content ?? null}
        createdAt={activeAnnouncement?.created_at}
      />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 单条卡片：倒计时圆环 + 自动消失各自独立（按通知 id 计时）
function PopupCard({
  item,
  view,
  useGlass,
  onDismiss,
  onClick,
}: {
  item: QueueItem
  view: CardView
  useGlass: boolean
  onDismiss: (id: string) => void
  onClick: (item: QueueItem) => void
}) {
  // 倒计时圆环偏移：0=满环，RING_C=空环
  const [ringOffset, setRingOffset] = useState(0)
  // 内容是否溢出（决定是否启用渐隐截断）
  const [truncated, setTruncated] = useState(false)
  const bodyWrapRef = useRef<HTMLSpanElement | null>(null)
  const dismissedRef = useRef(false)

  // 倒计时 + 自动消失，按通知 id 重置
  useEffect(() => {
    setRingOffset(0)
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setRingOffset(RING_C))
    })
    const timer = setTimeout(() => {
      if (!dismissedRef.current) {
        dismissedRef.current = true
        onDismiss(item.id)
      }
    }, AUTO_DISMISS_MS)
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  // 测量内容是否溢出（标题/内容回填后会变化，故依赖 view.body/view.title）
  useLayoutEffect(() => {
    const el = bodyWrapRef.current
    if (!el) {
      setTruncated(false)
      return
    }
    setTruncated(el.scrollHeight - el.clientHeight > 1)
  }, [item.id, view.body])

  const safeDismiss = () => {
    if (dismissedRef.current) return
    dismissedRef.current = true
    onDismiss(item.id)
  }

  return (
    <motion.div
      className="ann-pop-card"
      layout
      style={{
        background: useGlass ? "rgba(22, 22, 30, 0.62)" : "rgba(24, 24, 32, 0.94)",
        backdropFilter: useGlass ? "blur(26px) saturate(150%)" : "none",
        WebkitBackdropFilter: useGlass ? "blur(26px) saturate(150%)" : "none",
        willChange: "transform, opacity",
      }}
      initial={{ opacity: 0, y: -26, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -18, scale: 0.97, transition: { duration: 0.2, ease: "easeOut" } }}
      transition={{ type: "spring", stiffness: 330, damping: 30, mass: 0.85 }}
    >
      <span className="ann-pop-sheen" aria-hidden />

      {/* 主体：点击看详情（私信→打开聊天；公开通知→按类型跳转/开 Modal） */}
      <button type="button" className="ann-pop-main" onClick={() => onClick(item)}>
        <span className="ann-pop-logo">
          <img src={view.logoUrl} alt="通知" />
        </span>
        <span className="ann-pop-text">
          <span className="ann-pop-eyebrow">{view.eyebrow}</span>
          <span className="ann-pop-title">{view.title}</span>
          <span ref={bodyWrapRef} className={`ann-pop-body-wrap${truncated ? " is-trunc" : ""}`}>
            <span className="ann-pop-body">{view.body}</span>
          </span>
        </span>
      </button>

      {/* 点亮倒计时圆环 + 中心 X：点击关闭 */}
      <button type="button" className="ann-pop-ring" onClick={safeDismiss} aria-label="关闭通知">
        <svg className="ann-pop-ring-svg" width="32" height="32" viewBox="0 0 32 32">
          <circle className="ann-pop-ring-track" cx="16" cy="16" r={RING_R} fill="none" strokeWidth="2.5" />
          <circle
            className="ann-pop-ring-prog"
            cx="16"
            cy="16"
            r={RING_R}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{
              strokeDasharray: RING_C,
              strokeDashoffset: ringOffset,
              transition: `stroke-dashoffset ${AUTO_DISMISS_MS}ms linear`,
            }}
          />
        </svg>
        <X className="ann-pop-x" strokeWidth={2.5} />
      </button>
    </motion.div>
  )
}

const POPUP_CSS = `
.ann-pop-root{
  position:fixed; left:0; right:0;
  top:calc(env(safe-area-inset-top, 0px) + 10px);
  z-index:9990;
  display:flex; flex-direction:column; align-items:center; gap:8px;
  padding:0 10px;
  pointer-events:none; /* 空白处点击穿透到页面 */
}
.ann-pop-card{
  position:relative; pointer-events:auto;
  display:flex; align-items:center; gap:12px;
  width:min(94vw, 460px);
  padding:9px 13px;
  border-radius:20px;
  border:1px solid rgba(255,255,255,0.14);
  box-shadow:
    0 14px 40px rgba(0,0,0,0.45),
    0 0 26px rgba(163,230,53,0.10),
    inset 0 1px 0 rgba(255,255,255,0.10);
  overflow:hidden;
  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
}
/* 玻璃上沿高光线（与站点其它毛玻璃面板同款反光） */
.ann-pop-sheen{
  position:absolute; top:0; left:12%; right:12%; height:1px; pointer-events:none;
  background:linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
}
/* 主体可点区域：撑满中段 */
.ann-pop-main{
  flex:1 1 auto; min-width:0;
  display:flex; align-items:center; gap:11px;
  background:transparent; border:none; padding:0; margin:0;
  text-align:left; color:inherit; font:inherit; cursor:pointer;
}
.ann-pop-logo{
  flex:0 0 auto; width:40px; height:40px;
  border-radius:9999px; overflow:hidden;
  border:1px solid rgba(255,255,255,0.18);
  background:rgba(0,0,0,0.4);
}
.ann-pop-logo img{ width:100%; height:100%; object-fit:cover; display:block; }
.ann-pop-text{ flex:1 1 auto; min-width:0; display:block; }
.ann-pop-eyebrow{
  display:block; font-size:10px; font-weight:600; letter-spacing:.02em;
  color:#a3e635; margin-bottom:1px;
}
.ann-pop-title{
  display:block; font-size:14px; font-weight:700; color:#fff; line-height:1.25;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
/* 内容预览：裁切到 2 行，溢出时底部用不透明度渐隐截断（模糊方案因物理限制已弃用） */
.ann-pop-body-wrap{
  position:relative; display:block;
  font-size:12.5px; line-height:1.4;
  max-height:2.8em; overflow:hidden;
  margin-top:1px;
}
/* 仅当内容真的溢出时才加渐隐 mask；渐隐曲线多段平滑，避免硬断点 */
.ann-pop-body-wrap.is-trunc{
  -webkit-mask-image:linear-gradient(to bottom, #000 0%, #000 48%, rgba(0,0,0,0.78) 66%, rgba(0,0,0,0.34) 86%, transparent 100%);
  mask-image:linear-gradient(to bottom, #000 0%, #000 48%, rgba(0,0,0,0.78) 66%, rgba(0,0,0,0.34) 86%, transparent 100%);
}
.ann-pop-body{
  display:block; margin:0;
  font-size:12.5px; line-height:1.4; color:#c3cad2;
  white-space:pre-wrap; word-break:break-word;
}
/* 点亮倒计时圆环 + 中心 X */
.ann-pop-ring{
  position:relative; flex:0 0 auto;
  width:34px; height:34px;
  display:inline-flex; align-items:center; justify-content:center;
  background:transparent; border:none; padding:0; cursor:pointer;
  border-radius:9999px;
}
.ann-pop-ring-svg{ position:absolute; inset:0; margin:auto; }
.ann-pop-ring-track{ stroke:rgba(255,255,255,0.16); }
.ann-pop-ring-prog{
  stroke:#a3e635;
  transform:rotate(-90deg); transform-origin:50% 50%;
  filter:drop-shadow(0 0 3px rgba(163,230,53,0.6));
}
.ann-pop-x{
  position:relative; width:13px; height:13px;
  color:rgba(255,255,255,0.72); transition:color .15s ease;
}
.ann-pop-ring:hover .ann-pop-x{ color:#fff; }
@media (prefers-reduced-motion: reduce){
  .ann-pop-ring-prog{ transition:none !important; }
}
`
