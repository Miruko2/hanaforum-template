"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { X } from "lucide-react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useNotifications } from "@/contexts/notification-context"
import { cdnUrl } from "@/lib/cdn-url"
import { getAnnouncement, getPost, likePost, unlikePost, checkUserLiked } from "@/lib/supabase"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import AnnouncementModal from "@/components/announcement-modal"
import PostDetailModal from "@/components/post-detail-modal"
import { useRouter } from "next/navigation"
import type { Notification, Post } from "@/lib/types"

/**
 * 通用通知顶部弹窗（仿 macOS 通知，纵向堆叠）。
 *
 * 由 announcement-popup（仅公告单条）升级而来：
 *   - 数据源改用 useNotifications() 的完整通知列表，所有类型都弹；
 *   - 多条以纵向堆叠形式出现，新通知从顶部滑入、旧的往下推，最多同时显示 MAX_VISIBLE 条；
 *   - 点击主体按通知类型复刻铃铛行为（公告→全文 Modal、follow→主页、点赞/评论→帖子详情 Modal）。
 *
 * 「已弹过」用 per-user localStorage 的 id 集合记录，与铃铛 is_read 解耦：
 * 铃铛一打开就会把所有通知 markAllAsRead，若用 is_read 判定是否弹窗会彻底失效。
 * 离线收到的通知：NotificationProvider 登入即拉取列表 → 本组件的候选 effect 自动覆盖。
 *
 * 数据上的取舍（见计划）：
 *   - 非公告类通知自带 message / actor，零额外请求；
 *   - 公告类通知 message 仅是预览，进队列时先用 message 占位，后台 getAnnouncement 回填标题/内容。
 */

// 自动消失时长（毫秒）。圆环视觉与此同步。
const AUTO_DISMISS_MS = 20000
// 同时最多可见条数；超出时最老的淡出。
const MAX_VISIBLE = 5
// poppedSet 容量上限，防 localStorage 无限增长（保留最近 POPPED_CAP 个 id）。
const POPPED_CAP = 200

// 倒计时圆环几何
const RING_R = 12
const RING_C = 2 * Math.PI * RING_R

const poppedKey = (uid: string) => `firefly:notif-popped:${uid}`

// 卡片展示用的解析结果：从一条 Notification 提取 logo / eyebrow / title / body / 是否需要公告全文回填。
interface CardView {
  logoUrl: string
  eyebrow: string
  title: string
  body: string
  // 公告类需要二次请求回填完整标题/内容（占位用 message）
  needAnnouncementFill: boolean
}

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
      }
    case "like_post":
    case "like_comment":
      return {
        logoUrl: actorAvatar,
        eyebrow: "点赞通知",
        title: `${actorName} 赞了你`,
        body: n.message || "",
        needAnnouncementFill: false,
      }
    case "comment_post":
      return {
        logoUrl: actorAvatar,
        eyebrow: "评论通知",
        title: `${actorName} 评论了你`,
        body: n.message || "",
        needAnnouncementFill: false,
      }
    case "follow":
      return {
        logoUrl: actorAvatar,
        eyebrow: "关注通知",
        title: `${actorName} 关注了你`,
        body: n.message || "",
        needAnnouncementFill: false,
      }
    case "post_removed":
      return {
        logoUrl: "/logo.png",
        eyebrow: "系统通知",
        title: "你的帖子被移除",
        body: n.message || "",
        needAnnouncementFill: false,
      }
    default:
      return {
        logoUrl: actorAvatar,
        eyebrow: "通知",
        title: actorName,
        body: n.message || "",
        needAnnouncementFill: false,
      }
  }
}

// 安卓等弱合成器：去 backdrop-filter，改近实底深色底。
function detectAndroid(): boolean {
  return typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
}

export default function AnnouncementPopup() {
  const { user, isAdmin } = useSimpleAuth()
  const { notifications, markAsRead } = useNotifications()
  const { toast } = useToast()
  const isMobile = useIsMobile()
  const router = useRouter()

  // 当前在显的通知队列（最多 MAX_VISIBLE 条）
  const [queue, setQueue] = useState<Notification[]>([])
  // 每条卡片的展示视图（公告回填后更新对应条目）
  const [views, setViews] = useState<Record<string, CardView>>({})

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

  // 候选选择：每当 notifications 变化，把「未弹过」的新通知补进队列，截断到 MAX_VISIBLE。
  // 实时到达（realtime 推新）与离线补弹（登入首次拉取填充列表）都走这一条 effect。
  useEffect(() => {
    if (!user) return
    const popped = poppedRef.current
    const candidates = notifications
      .filter((n) => !popped.has(n.id))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

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

  // 为队列中的公告通知异步回填完整标题/内容（非公告类零请求）
  useEffect(() => {
    let cancelled = false
    const fill = async () => {
      for (const n of queue) {
        const v = views[n.id] ?? viewOf(n)
        if (!v.needAnnouncementFill) continue
        if (views[n.id] && !views[n.id].needAnnouncementFill) continue // 已回填
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

  // 点击主体：复刻 notification-bell.tsx 的 handleNotificationClick（1:1）
  const handleClick = async (n: Notification) => {
    try {
      dismissOne(n.id)
      if (!n.is_read) markAsRead(n.id)

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
        if (!n.is_read) markAsRead(n.id)
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
        {queue.map((n) => {
          const view = views[n.id] ?? viewOf(n)
          return (
            <PopupCard
              key={n.id}
              notification={n}
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
  notification,
  view,
  useGlass,
  onDismiss,
  onClick,
}: {
  notification: Notification
  view: CardView
  useGlass: boolean
  onDismiss: (id: string) => void
  onClick: (n: Notification) => void
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
        onDismiss(notification.id)
      }
    }, AUTO_DISMISS_MS)
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notification.id])

  // 测量内容是否溢出（标题/内容回填后会变化，故依赖 view.body/view.title）
  useLayoutEffect(() => {
    const el = bodyWrapRef.current
    if (!el) {
      setTruncated(false)
      return
    }
    setTruncated(el.scrollHeight - el.clientHeight > 1)
  }, [notification.id, view.body])

  const safeDismiss = () => {
    if (dismissedRef.current) return
    dismissedRef.current = true
    onDismiss(notification.id)
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

      {/* 主体：点击看详情（按类型跳转/开 Modal） */}
      <button type="button" className="ann-pop-main" onClick={() => onClick(notification)}>
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
