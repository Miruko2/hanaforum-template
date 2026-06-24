"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import dynamic from "next/dynamic"
import { motion } from "framer-motion"
import { Archive, X } from "lucide-react"
import type { Post } from "@/lib/types"
import { cdnUrl } from "@/lib/cdn-url"
import { postThumbUrl } from "@/lib/post-image-thumb"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import { checkUserLiked, likePost, unlikePost } from "@/lib/supabase"
import { collectPost, uncollectPost } from "@/lib/collections"
import CollectionPostcard from "./collection-postcard"

const PostDetailModal = dynamic(() => import("@/components/post-detail-modal"), { ssr: false })

// 个人主页「我的收藏」集邮册。移植自 public/stamp-archive-demo.html：
//   三段式 —— 闭合 → 半开预览 → 完全展开（可拖动/滚轮横向浏览）。
// 入口＝侧栏一个「我的收藏」按钮，点开后集邮册以居中弹窗、完整尺寸浮现。
// 邮票由真实收藏帖动态生成（数量任意），位置靠内联 CSS 变量驱动（见 globals.css 注释）。
// 点邮票放大聚焦，再点同一张打开帖子详情（复用全站 PostDetailModal）。
// 私密收藏：仅本人可见，所以只放在「我的」主页。

// useLayoutEffect 客户端同步测量缩放，避免首帧以未缩放(540px)闪现；SSR 退回 useEffect
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

const COLORS = ["amber", "pink", "ink", "lime"] as const
type ColorKey = (typeof COLORS)[number]
const COLOR_STORAGE_KEY = "collectionFolderColor"

// 邮票铺排：第一张钉在文件夹里，其余从 130px 起每隔 94px 一列（与 demo 一致）
const SPREAD_START = 130
const SPREAD_GAP = 94
// 滚到末尾后继续推够这么多，第一张回收、收藏夹合上（移植自 demo 的关闭手势）
const CLOSE_PUSH = 230

// 集邮册设计尺寸（固定 540×530）。在弹窗里按可用「宽 + 高」等比缩放：
// 去掉原「不超过 1 倍」上限以便放大填满更大的弹窗，受可视高度约束、上限 1.4。
const STAGE_W = 540
const STAGE_H = 530

// 预览态前 3 张的扇位（升起 + 旋转）
const FAN = [
  { x: 20, y: -52, r: 4 },
  { x: -8, y: -64, r: -7 },
  { x: -38, y: -46, r: -14 },
]

// 无图帖的占位渐变（按邮票序号轮换）
const GRADS = [
  "linear-gradient(150deg,#ff8a3d,#ffd07a)",
  "linear-gradient(150deg,#16b7a6,#5fe3c7)",
  "linear-gradient(150deg,#7c5cff,#b57bff)",
  "linear-gradient(150deg,#3b9eff,#7ec8ff)",
  "linear-gradient(150deg,#ff5a6e,#ffa07a)",
  "linear-gradient(150deg,#ff8ad0,#ffc4e6)",
]

// 单张邮票画面：有图走 640px 缩略图省 egress（onError 回退主图）；
// 音乐分享帖用歌曲封面；都没有则占位渐变 + emoji。
function StampPic({ post, index }: { post: Post; index: number }) {
  const hasImg = !!post.image_url
  const main = cdnUrl(post.image_url)
  const thumb = cdnUrl(postThumbUrl(post.image_url))
  const musicCover = post.music?.cover ? cdnUrl(post.music.cover) : ""
  const src = hasImg ? thumb || main : musicCover

  if (src) {
    return (
      <div className="pic">
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={(e) => {
            const img = e.currentTarget
            if (hasImg && thumb && main && img.src !== main) img.src = main
          }}
        />
      </div>
    )
  }
  return (
    <div className="pic" style={{ background: GRADS[index % GRADS.length] }}>
      {post.imageContent || "📌"}
    </div>
  )
}

export default function CollectionArchive({
  posts,
  loading,
}: {
  posts: Post[]
  loading: boolean
}) {
  const { user, isAdmin } = useSimpleAuth()
  const { toast } = useToast()
  const isMobile = useIsMobile()

  // 收藏帖（本地副本，弹窗里取消收藏可即时从册中移除）
  const [items, setItems] = useState<Post[]>(posts)
  useEffect(() => setItems(posts), [posts])

  // 收藏夹弹窗开关（按钮入口 → 居中弹窗，集邮册在弹窗里用完整尺寸）
  const [archiveOpen, setArchiveOpen] = useState(false)

  // 三段式状态机 / 滚动 / 焦点 / 配色 / 自适应缩放
  const [state, setState] = useState(0) // 0 闭合 / 1 预览 / 2 展开
  const [scroll, setScrollState] = useState(0)
  const [closeP, setCloseP] = useState(0) // 关闭手势进度 0→1（驱动第一张回收）
  const [focusId, setFocusId] = useState<string | null>(null)
  const [focusFx, setFocusFx] = useState(0)
  const [color, setColor] = useState<ColorKey>("amber")
  const [scale, setScale] = useState(1)

  // 点开邮票 → 在收藏夹弹窗内就地展开的「明信片」详情（轻量版 A）。
  // active 同时供明信片与「看评论」论坛弹窗使用（同一帖），open 仅控制论坛评论弹窗。
  const [postcardOpen, setPostcardOpen] = useState(false)

  // 详情弹窗（复用 PostTimeline 同款：自管理点赞态）
  const [active, setActive] = useState<Post | null>(null)
  const [open, setOpen] = useState(false)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [isLiking, setIsLiking] = useState(false)
  const [activeCollected, setActiveCollected] = useState(true)
  const [isCollecting, setIsCollecting] = useState(false)

  const N = items.length
  const lastEx = N >= 2 ? SPREAD_START + (N - 2) * SPREAD_GAP : 0
  const MIN_SCROLL = N >= 2 ? -Math.max(0, lastEx - 146) : 0

  // 供「挂一次」的原生监听器读取的实时值
  const stageRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef(state)
  const scrollRef = useRef(0)
  const focusRef = useRef<string | null>(null)
  const minScrollRef = useRef(MIN_SCROLL)
  const dragRef = useRef({ drag: false, sx: 0, base: 0, moved: false })
  const suppressRef = useRef(false) // 拖动后抑制紧跟的 folder click（避免误收起）
  const scaleRef = useRef(1)
  const overEndRef = useRef(0) // 滚到末尾后继续推的累积量（关闭手势）

  useEffect(() => {
    stateRef.current = state
  }, [state])
  useEffect(() => {
    focusRef.current = focusId
  }, [focusId])

  const setScroll = useCallback((v: number) => {
    const min = minScrollRef.current
    const nv = Math.max(min, Math.min(0, v))
    scrollRef.current = nv
    setScrollState(nv)
  }, [])

  // 关闭手势触发：折叠收藏夹回闭合态（滚到末尾继续推够即触发）
  const closeFolder = useCallback(() => {
    setState(0)
    setScroll(0)
    setFocusId(null)
    overEndRef.current = 0
    setCloseP(0)
  }, [setScroll])

  // 收藏数变化 → 更新可滚动下界，并把越界的滚动收回
  useEffect(() => {
    minScrollRef.current = MIN_SCROLL
    if (scrollRef.current < MIN_SCROLL) setScroll(MIN_SCROLL)
  }, [MIN_SCROLL, setScroll])

  // 自适应缩放：按弹窗内可用「宽 + 高」等比缩放 540×530 设计（保留所有内部数值）。
  //   · 去掉原 min(1) 上限 → 大弹窗里可放大>1 倍填满；
  //   · 受可视高度约束(留 170px 给头部/提示/边距)，避免竖向超出视口；
  //   · 上限 1.4，下限 0.5。
  // 依赖 archiveOpen：弹窗打开、集邮册挂载后才测得到；窗口尺寸/旋转变化也重算。
  useIsoLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => {
      const widthScale = el.clientWidth / STAGE_W
      const heightScale = (window.innerHeight - 170) / STAGE_H
      const s = Math.max(0.5, Math.min(1.4, widthScale, heightScale))
      scaleRef.current = s
      setScale(s)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener("resize", update)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [archiveOpen, loading, postcardOpen])

  // 读取/记忆配色（本地，无需后端）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(COLOR_STORAGE_KEY) as ColorKey | null
      if (saved && (COLORS as readonly string[]).includes(saved)) setColor(saved)
    } catch {
      /* localStorage 不可用：用默认色 */
    }
  }, [])
  const pickColor = (c: ColorKey) => {
    setColor(c)
    try {
      localStorage.setItem(COLOR_STORAGE_KEY, c)
    } catch {
      /* 忽略 */
    }
  }

  // 滚轮横向浏览（仅展开态）；到两端继续推则放行让页面正常竖向滚动
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (stateRef.current !== 2) return
      if (focusRef.current) {
        setFocusId(null)
        return
      }
      e.preventDefault()
      const fwd = e.deltaY + e.deltaX
      const cur = scrollRef.current
      const min = minScrollRef.current
      if (cur <= min && fwd > 0) {
        // 已滚到末尾还继续往后推 → 累积关闭意图：第一张回收，推够就合上收藏夹
        overEndRef.current += fwd
        setCloseP(Math.max(0, Math.min(1, overEndRef.current / CLOSE_PUSH)))
        if (overEndRef.current >= CLOSE_PUSH) closeFolder()
      } else if (overEndRef.current > 0 && fwd < 0) {
        // 往回滚先消解关闭意图（第一张重新探出）
        overEndRef.current = Math.max(0, overEndRef.current + fwd)
        setCloseP(Math.max(0, Math.min(1, overEndRef.current / CLOSE_PUSH)))
      } else {
        setScroll(cur - fwd)
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [setScroll, archiveOpen, closeFolder, loading, postcardOpen])

  // 拖动横向浏览（鼠标 / 触屏；touch-action:pan-y 让竖向滚动照常穿过）。dx 按缩放校正回内部坐标。
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d.drag) return
      const dx = (e.clientX - d.sx) / scaleRef.current
      if (Math.abs(dx) > 4) {
        d.moved = true
        if (focusRef.current) setFocusId(null) // 拖动浏览时把放大的邮票收回序列
      }
      setScroll(d.base + dx)
    }
    const up = () => {
      const d = dragRef.current
      if (d.drag && d.moved) suppressRef.current = true
      d.drag = false
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
  }, [setScroll])

  // 收藏夹弹窗开关：关闭时把集邮册重置回闭合态（下次打开从头开始）+ 收起明信片/评论弹窗
  const openArchive = useCallback(() => setArchiveOpen(true), [])
  const closeArchive = useCallback(() => {
    setArchiveOpen(false)
    setState(0)
    setScroll(0)
    setFocusId(null)
    overEndRef.current = 0
    setCloseP(0)
    setPostcardOpen(false)
    setActive(null)
    setOpen(false)
  }, [setScroll])

  // 明信片 → 返回集邮册（顺手收掉可能开着的评论弹窗）
  const backToArchive = useCallback(() => {
    setPostcardOpen(false)
    setActive(null)
    setOpen(false)
    setFocusId(null) // 回到集邮册时把之前放大的那张收回序列
  }, [])

  // 撕开票券 → 弹出论坛原版帖子（active 已是同一帖）；同时退出票券视图，
  // 这样看完帖子关闭后回到集邮册（而非停在撕开的票券上）。
  const tearOpenPost = useCallback(() => {
    setOpen(true)
    setPostcardOpen(false)
  }, [])

  // 弹窗打开时支持 Esc 关闭，逐层退：评论弹窗 → 明信片 → 收藏夹
  useEffect(() => {
    if (!archiveOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (open) setOpen(false)
      else if (postcardOpen) backToArchive()
      else closeArchive()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [archiveOpen, open, postcardOpen, backToArchive, closeArchive])

  // 弹窗打开时锁住页面滚动（否则在弹窗内滚轮会带动背后页面一起滚）；
  // 补偿滚动条宽度避免背景横移一下
  useEffect(() => {
    if (!archiveOpen) return
    const html = document.documentElement
    const body = document.body
    const scrollbarW = window.innerWidth - html.clientWidth
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPad: body.style.paddingRight,
    }
    // 同时锁 html 和 body：本页滚动条挂在 <html> 上，只锁 body 拦不住（弹窗内滚轮会带动整页滚）。
    // 再加全站约定的 .modal-open 类（带 touch-action:none，移动端锁触摸滚动；page-swipe 也据此让路）。
    html.style.overflow = "hidden"
    body.style.overflow = "hidden"
    body.classList.add("modal-open")
    if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`
    return () => {
      html.style.overflow = prev.htmlOverflow
      body.style.overflow = prev.bodyOverflow
      body.style.paddingRight = prev.bodyPad
      body.classList.remove("modal-open")
    }
  }, [archiveOpen])

  const onStagePointerDown = (e: React.PointerEvent) => {
    if (state !== 2) return
    // 注意：不在 pointerdown 清聚焦——否则「再点已聚焦的邮票」会在 click 触发前就被清掉，
    // 永远进不了「打开明信片」分支（这正是之前「再点没反应」的真凶）。
    // 聚焦改由「拖动真正移动时」（见下方 pointermove）或滚轮清除。
    dragRef.current = { drag: true, sx: e.clientX, base: scrollRef.current, moved: false }
  }

  // 点文件夹：循环 闭合→预览→展开→闭合；离开展开态时归零滚动/焦点
  const onFolderClick = () => {
    if (suppressRef.current) {
      suppressRef.current = false
      return
    }
    if (N === 0) return // 空册不展开
    const next = (state + 1) % 3
    if (next !== 2) {
      setScroll(0)
      setFocusId(null)
      overEndRef.current = 0
      setCloseP(0)
    }
    setState(next)
  }

  // 点邮票：第一下放大聚焦（居中放大预览）；再点同一张 → 展开「明信片」详情；
  // 点另一张则改聚焦那张。拖动浏览时不触发。
  const onStampClick = (post: Post, e: React.MouseEvent) => {
    if (state !== 2) return
    e.stopPropagation()
    if (dragRef.current.moved) return // 刚才是拖动，不触发
    if (focusId === post.id) {
      openPostcard(post)
      return
    }
    setFocusFx(scrollRef.current - 260)
    setFocusId(post.id)
  }

  // ───────── 明信片详情（复用 PostTimeline 点赞逻辑） ─────────
  const openPostcard = async (post: Post) => {
    setActive(post)
    setLikeCount(post.likes_count || 0)
    setLiked(false)
    setActiveCollected(true) // 能在册里出现＝已收藏
    setPostcardOpen(true)
    if (user) {
      try {
        const l = await checkUserLiked(post.id, user.id)
        setLiked(!!l)
      } catch {
        /* 默认未点赞 */
      }
    }
  }

  const patchActive = (patch: Partial<Post>) => {
    setActive((prev) => (prev ? { ...prev, ...patch } : prev))
    setItems((prev) => prev.map((p) => (active && p.id === active.id ? { ...p, ...patch } : p)))
  }

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!active) return
    if (!user) {
      toast({ title: "请先登录", description: "点赞前请先登录账号", variant: "destructive" })
      return
    }
    if (isLiking) return
    const prevLiked = liked
    const prevCount = likeCount
    const newLiked = !prevLiked
    const newCount = newLiked ? prevCount + 1 : Math.max(0, prevCount - 1)
    try {
      setIsLiking(true)
      setLiked(newLiked)
      setLikeCount(newCount)
      if (newLiked) await likePost(active.id, user.id)
      else await unlikePost(active.id, user.id)
      patchActive({ likes_count: newCount })
    } catch {
      setLiked(prevLiked)
      setLikeCount(prevCount)
      toast({ title: "操作失败", description: "点赞失败，请稍后重试", variant: "destructive" })
    } finally {
      setIsLiking(false)
    }
  }

  // 弹窗里取消收藏 → 即时把该邮票从册中移除；重新收藏 → 加回册首
  const handleModalCollect = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user || !active) return
    if (isCollecting) return
    const target = active
    try {
      setIsCollecting(true)
      if (activeCollected) {
        await uncollectPost(target.id, user.id)
        setActiveCollected(false)
        setFocusId(null)
        setItems((prev) => prev.filter((p) => p.id !== target.id))
      } else {
        await collectPost(target.id, user.id)
        setActiveCollected(true)
        setItems((prev) => (prev.some((p) => p.id === target.id) ? prev : [target, ...prev]))
      }
    } catch {
      toast({ title: "操作失败", description: "收藏操作失败，请稍后重试", variant: "destructive" })
    } finally {
      setIsCollecting(false)
    }
  }

  const handleCommentAdded = () => {
    if (!active) return
    patchActive({ comments_count: (active.comments_count || 0) + 1 })
  }

  // ───────── 渲染 ─────────
  const hint =
    N === 0
      ? "去帖子点书签，收藏就会出现在这里"
      : state === 0
        ? "点一下打开收藏夹"
        : state === 1
          ? "再点一下完全展开"
          : focusId
            ? "再点一下这张邮票打开 · 或滚动/拖动浏览"
            : "点邮票放大 · 再点一下打开 · 滚动或拖动横向浏览 · 点收藏夹收起"

  return (
    <>
      {/* 入口按钮（侧栏）：点开后集邮册以居中弹窗、完整尺寸浮现 */}
      <button
        type="button"
        onClick={openArchive}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white/85 backdrop-blur-xl transition-colors hover:bg-white/20 hover:text-white"
      >
        <Archive className="h-4 w-4" />
        我的收藏
        <span className="ml-1 rounded-full bg-lime-400/20 px-2 py-0.5 text-xs font-semibold tabular-nums text-lime-300">
          {N}
        </span>
      </button>

      {/* 集邮册弹窗：集邮册用完整尺寸；点邮票开的帖子详情(更晚挂载)会盖在其上。
          archiveOpen 为真才 createPortal（SSR 时为假、不访问 document）。 */}
      {archiveOpen &&
        createPortal(
          <div className="fixed inset-0 z-40 flex items-center justify-center p-2 sm:p-4">
            {/* 半透明遮罩：作为面板的兄弟(非祖先)，其 opacity 入场不会破坏面板毛玻璃的背景采样 */}
            <motion.div
              className="absolute inset-0 bg-black/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              onClick={postcardOpen ? backToArchive : closeArchive}
            />
            {/* 票券详情时只显示大票券(无外层毛玻璃面板)，撕开虚线弹原帖；否则显示集邮册面板 */}
            {postcardOpen && active ? (
              <CollectionPostcard
                post={active}
                username={active.username || active.users?.username || "用户"}
                color={color}
                index={items.findIndex((p) => p.id === active.id)}
                likeCount={likeCount}
                onOpenPost={tearOpenPost}
              />
            ) : (
            <motion.div
              className="relative z-10 w-[min(820px,96vw)] rounded-3xl border border-white/15 bg-[#0c0d12]/50 p-3 shadow-[0_30px_80px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-2xl backdrop-saturate-150 sm:p-5"
              initial={{ opacity: 0, scale: 0.94, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
            >
                {/* 头部：标题 + 收藏数 + 关闭 */}
                <div className="mb-3 flex items-center justify-between px-1">
                  <h3 className="text-lg font-black italic tracking-tight text-white">
                    我的收藏
                    <span className="ml-2 text-sm font-semibold not-italic text-lime-300">· {N}</span>
                  </h3>
                  <button
                    type="button"
                    onClick={closeArchive}
                    aria-label="关闭"
                    className="grid h-9 w-9 place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-20 text-sm text-white/40">
                    加载中…
                  </div>
                ) : (
                  <div ref={stageRef} className="stamp-archive" onPointerDown={onStagePointerDown}>
                    <div className="sa-scale" style={{ height: STAGE_H * scale }}>
                      <div
                        className="sa-stage"
                        style={{ transform: `translateX(-50%) scale(${scale})` }}
                      >
                        <div className="scene">
                          <div
                            className={`folder c-${color}${state >= 1 ? " open" : ""}${state === 2 ? " expanded" : ""}`}
                            style={
                              { "--scroll": `${scroll}px`, "--closeP": closeP } as React.CSSProperties
                            }
                            onClick={onFolderClick}
                          >
                            <div className="back" />

                            <div className="tray-clip">
                              <div className="tray">
                                {items.map((post, i) => {
                                  const fan = i < 3
                                  const isPinned = i === 0
                                  const isFocused = focusId === post.id
                                  const isDimmed = focusId !== null && !isFocused
                                  const cls = [
                                    "stamp-wrap",
                                    isPinned ? "pinned" : "",
                                    fan ? "fan" : "",
                                    i === 1 ? "d1" : i === 2 ? "d2" : "",
                                    isFocused ? "focused" : "",
                                    isDimmed ? "dimmed" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")

                                  const style: Record<string, string | number> = {
                                    zIndex: Math.max(1, 40 - i),
                                  }
                                  if (fan) {
                                    style["--pvx"] = `${FAN[i].x}px`
                                    style["--pvy"] = `${FAN[i].y}px`
                                    style["--pvr"] = `${FAN[i].r}deg`
                                  }
                                  if (i >= 1) style["--ex"] = `${SPREAD_START + (i - 1) * SPREAD_GAP}px`
                                  if (isFocused) style["--fx"] = `${focusFx}px`

                                  return (
                                    <div
                                      key={post.id}
                                      className={cls}
                                      style={style as React.CSSProperties}
                                      onClick={(e) => onStampClick(post, e)}
                                    >
                                      <div className="stamp">
                                        <div className="art">
                                          <StampPic post={post} index={i} />
                                          <div className="meta">
                                            <div className="t">{post.title || "无标题"}</div>
                                            <div className="n">No.{String(i + 1).padStart(2, "0")}</div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>

                            <div className="front">
                              <div className="seal">
                                收藏
                                <br />
                                ARCHIVE
                              </div>
                              <div className="jp">あつめたもの</div>
                              <div className="label">我的收藏</div>
                              <div className="sub">ARCHIVE</div>
                              <div className="lines">
                                <i />
                                <i />
                                <i />
                              </div>
                            </div>
                          </div>
                          <div className="sa-shadow" />
                        </div>

                        {N === 0 && <div className="sa-empty">还没有收藏任何帖子</div>}

                        {/* 调色盘 */}
                        <div className="swatches">
                          {COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              aria-label={`配色 ${c}`}
                              className={`sw sw-${c}${color === c ? " on" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                pickColor(c)
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <p className="mt-3 text-center text-xs text-white/40">{hint}</p>
                  </div>
                )}
            </motion.div>
            )}
          </div>,
          document.body,
        )}

      {active && (
        <PostDetailModal
          post={active}
          isOpen={open}
          onClose={() => setOpen(false)}
          onLike={handleLike}
          onCommentAdded={handleCommentAdded}
          liked={liked}
          likeCount={likeCount}
          isLiking={isLiking}
          collected={activeCollected}
          isCollecting={isCollecting}
          onCollect={handleModalCollect}
          username={active.username || active.users?.username || "用户"}
          avatarUrl={active.users?.avatar_url || null}
          isMobile={isMobile}
          isAdmin={isAdmin}
        />
      )}
    </>
  )
}
