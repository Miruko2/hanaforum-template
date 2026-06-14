"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence, type MotionProps } from "framer-motion"
import dynamic from "next/dynamic"
import { ThumbsUp, MessageSquare, Check, Trash2 } from "lucide-react"
import type { Post } from "@/lib/types"
import { CATEGORY_LABELS } from "@/lib/categories"
import { postThumbUrl } from "@/lib/post-image-thumb"
import { cdnUrl } from "@/lib/cdn-url"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import { likePost, unlikePost, checkUserLiked } from "@/lib/supabase"
import { deletePostWithUIUpdate } from "@/lib/post-delete-fix"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const PostDetailModal = dynamic(() => import("@/components/post-detail-modal"), { ssr: false })

// 社交页帖子时间线。响应式两套：
//   · 平板及以下：竖向——左侧竖向胶囊时间轴 + 右侧卡片列表，竖向滚动联动。
//   · PC(≥1024)：横向——卡片横排（错落漂浮 + 进场高斯模糊渐入）；鼠标滚轮驱动横向移动，
//     底部横向胶囊时间轴联动。PC 专属重效果，不影响走竖版的安卓/手机端。
// 卡片共用 TimelineCard；点开复用 PostDetailModal。

function fmtDate(s: string): string {
  const d = new Date(s)
  if (isNaN(d.getTime())) return ""
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

// ≥1024px 视为 PC（含 lg 断点）。首帧 false（走竖向），挂载后按真实视口切换。
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)")
    const on = () => setDesktop(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return desktop
}

// 时间轴导航最多同时显示的节点数（其余隐藏，避免帖子过多时密密麻麻）。
// 仿 index.html：以当前激活节点为中心开一个 W 节点的滑动窗口，右侧数字徽章当页码用。
const NAV_WINDOW = 5
// 窗口模式下节点间距（固定，窗口内最多 NAV_WINDOW 个点，不再随总数压缩）
const NODE_GAP = 44

// 计算可见窗口：返回起始全局 index 与窗口长度。activeIdx 尽量居中、两端不越界。
function navWindow(activeIdx: number, n: number): { start: number; len: number } {
  const len = Math.min(NAV_WINDOW, n)
  let start = activeIdx - Math.floor((len - 1) / 2)
  start = Math.max(0, Math.min(n - len, start))
  return { start, len }
}

// 点击数字徽章弹出的「跳转到第 N 条」输入弹窗（仿 index.html 的 jumpModal）。
// 居中浮层 + 点遮罩/Esc 关闭；回车或「跳转」确认，校验 1..total。
function JumpModal({
  total,
  current,
  onJump,
  onClose,
}: {
  total: number
  current: number // 1-based，当前位置（用作 placeholder）
  onJump: (idx1Based: number) => void
  onClose: () => void
}) {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  const commit = () => {
    const v = parseInt(value, 10)
    if (!isNaN(v) && v >= 1 && v <= total) onJump(v - 1)
    onClose()
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      >
        <motion.div
          className="flex w-44 flex-col items-center justify-center gap-3 rounded-2xl border border-white/20 bg-white/10 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-2xl"
          initial={{ opacity: 0, scale: 0.92, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 12 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={inputRef}
            type="number"
            min={1}
            max={total}
            value={value}
            placeholder={String(current)}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === "Enter") {
                e.preventDefault()
                commit()
              } else if (e.key === "Escape") {
                e.preventDefault()
                onClose()
              }
            }}
            className="w-14 rounded-xl border border-white/20 bg-white/5 px-2 py-1 text-center text-sm text-white placeholder:text-white/30 focus:border-lime-400/60 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            onClick={commit}
            className="rounded-full bg-lime-500 px-4 py-1 text-xs font-medium text-black transition-colors hover:bg-lime-400"
          >
            跳转
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}

// ───────── 共享卡片 ─────────
export function TimelineCard({
  post,
  onOpen,
  className = "",
  enter,
}: {
  post: Post
  onOpen: (p: Post) => void
  className?: string
  // 进场动效挂在卡片本体(毛玻璃元素)上：opacity/filter 与 backdrop-filter 同元素可共存，
  // 渐入是「更雾的玻璃→清玻璃」，不会先空透明再突然上玻璃（祖先做 opacity/filter 才会闪）。
  enter?: MotionProps
}) {
  const title = post.title || "无标题"
  // 方格封面用 640px 缩略图（lib/post-image-thumb 约定）省 egress；
  // 老帖没回填缩略图时 onError 回退主图
  const cover = cdnUrl(post.image_url)
  const coverThumb = cdnUrl(postThumbUrl(post.image_url))
  return (
    <div className={className}>
      <motion.button
        type="button"
        onClick={() => onOpen(post)}
        className="group block w-full overflow-hidden rounded-[1.7rem] border border-white/25 bg-gradient-to-br from-white/[0.18] to-white/[0.07] p-3 text-left shadow-[0_18px_50px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-lg transition-colors duration-300 hover:border-lime-400/45 hover:from-white/[0.22] hover:to-white/[0.09]"
        {...enter}
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-[1.15rem] bg-black/30">
          {cover ? (
            <img
              src={coverThumb || cover}
              alt={title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              onError={(e) => {
                const img = e.currentTarget
                if (coverThumb && img.src !== cover) img.src = cover
              }}
            />
          ) : (
            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-lime-900/30 via-emerald-900/20 to-black/30 text-5xl text-white/20">
              {post.imageContent || "🌱"}
            </div>
          )}
          {/* 日期 + 分类移到图片内左上角（半透明底，无毛玻璃省安卓开销） */}
          <div className="absolute left-2.5 top-2.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] tracking-wide text-white/90 shadow-[0_2px_8px_rgba(0,0,0,0.4)]">
            {fmtDate(post.created_at)}
            <span className="mx-1.5 text-white/45">·</span>
            {CATEGORY_LABELS[post.category] || post.category}
          </div>
        </div>
        <div className="px-1 pt-3">
          <h3 className="line-clamp-1 text-[15px] font-semibold text-white" title={title}>
            {title}
          </h3>
          <div className="mt-2 flex items-center gap-4 text-xs text-white/50">
            <span className="inline-flex items-center gap-1">
              <ThumbsUp className="h-3.5 w-3.5" />
              {post.likes_count || 0}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" />
              {post.comments_count || 0}
            </span>
          </div>
        </div>
      </motion.button>
    </div>
  )
}

function TimelineNode({
  active,
  passed,
  onClick,
  label,
  onGlass = false,
}: {
  active: boolean
  passed: boolean
  onClick: () => void
  label: string
  onGlass?: boolean
}) {
  const idle = onGlass
    ? "h-3 w-3 border-white/40 bg-transparent hover:border-lime-400/80"
    : "h-3 w-3 border-black/25 bg-transparent hover:border-lime-500/70"
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={
        "relative z-10 rounded-full border-2 transition-all duration-200 " +
        (active
          ? "h-4 w-4 border-lime-600 bg-lime-500 ring-4 ring-lime-500/30"
          : passed
            ? "h-3 w-3 border-lime-500 bg-lime-500"
            : idle)
      }
    />
  )
}

// ───────── 竖向视图（平板及以下） ─────────
function VerticalTimeline({ items, onOpen }: { items: Post[]; onOpen: (p: Post) => void }) {
  const cardRefs = useRef<(HTMLElement | null)[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [showJump, setShowJump] = useState(false)

  useEffect(() => {
    let ticking = false
    const compute = () => {
      ticking = false
      const line = window.innerHeight * 0.4
      let best = 0
      let bestDist = Infinity
      items.forEach((_, idx) => {
        const el = cardRefs.current[idx]
        if (!el) return
        const r = el.getBoundingClientRect()
        const center = r.top + r.height / 2
        const dist = Math.abs(center - line)
        if (dist < bestDist) {
          bestDist = dist
          best = idx
        }
      })
      setActiveIndex(best)
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(compute)
    }
    compute()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [items.length])

  const jumpTo = (idx: number) => {
    cardRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  const n = items.length
  const { start: navStart, len: navLen } = navWindow(activeIndex, n)
  const trackLen = (navLen - 1) * NODE_GAP
  const localActive = activeIndex - navStart
  const ratio = navLen <= 1 ? 0 : localActive / (navLen - 1)
  const activeTitle = items[activeIndex]?.title || ""
  const windowItems = items.slice(navStart, navStart + navLen)

  return (
    <div className="relative pl-14 sm:pl-0">
      <div className="space-y-9">
        {items.map((post, i) => (
          <div
            key={post.id}
            ref={(el) => {
              cardRefs.current[i] = el
            }}
            className="scroll-mt-24"
          >
            <TimelineCard
              post={post}
              onOpen={onOpen}
              className="ml-auto w-full max-w-[400px]"
              enter={{
                initial: { opacity: 0, y: 16 },
                whileInView: { opacity: 1, y: 0 },
                viewport: { once: true, margin: "-40px" },
                transition: { duration: 0.5, ease: "easeOut", delay: Math.min(i * 0.04, 0.3) },
              }}
            />
          </div>
        ))}
      </div>

      {n >= 2 && (
        <div className="fixed left-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-2 sm:left-5">
          <button
            onClick={() => setShowJump(true)}
            title="点击跳转到指定条目"
            className="rounded-full border border-white/25 bg-gradient-to-b from-white/20 to-white/10 px-3 py-1.5 text-sm font-semibold tabular-nums text-lime-300 shadow-[0_10px_30px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] transition-transform hover:scale-105"
          >
            {activeIndex + 1}
          </button>
          <div className="relative px-2.5 py-5">
            {/* 仿玻璃层：半透明白渐变 + 边框 + 顶部内高光（与 PC 端一致，竖向不变） */}
            <div className="absolute inset-0 rounded-full border border-white/25 bg-gradient-to-b from-white/20 to-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.3)]" />
            {activeTitle && (
              <div
                className="pointer-events-none absolute left-full z-10 ml-3 -translate-y-1/2 transition-[top] duration-300 ease-out"
                style={{ top: 20 + ratio * trackLen }}
              >
                <div className="relative">
                  {/* 实色气泡（无 backdrop-blur，省安卓开销也避免突兀的模糊层）；溢出裁剪让标题从底部滑入 */}
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/80 px-3.5 py-2 text-[13px] text-white shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
                    <motion.span
                      key={activeIndex}
                      initial={{ y: "110%", opacity: 0 }}
                      animate={{ y: "0%", opacity: 1 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      className="block max-w-[55vw] truncate"
                    >
                      {activeTitle}
                    </motion.span>
                  </div>
                  {/* 朝左指向胶囊的小箭头 */}
                  <span className="absolute left-0 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-neutral-900/80" />
                </div>
              </div>
            )}
            <div className="relative flex w-4 flex-col items-center" style={{ height: trackLen }}>
              <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-white/30" />
              <div
                className="absolute left-1/2 top-0 w-[3px] -translate-x-1/2 rounded-full bg-lime-400 transition-[height] duration-200"
                style={{ height: ratio * trackLen }}
              />
              <div className="relative flex h-full flex-col items-center justify-between">
                {windowItems.map((p, i) => {
                  const idx = navStart + i
                  return (
                    <TimelineNode
                      key={p.id}
                      active={idx === activeIndex}
                      passed={idx < activeIndex}
                      onClick={() => jumpTo(idx)}
                      label={`跳到第 ${idx + 1} 条`}
                      onGlass
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {showJump && (
        <JumpModal
          total={n}
          current={activeIndex + 1}
          onJump={(idx) => jumpTo(idx)}
          onClose={() => setShowJump(false)}
        />
      )}
    </div>
  )
}

// ───────── 横向视图（PC） ─────────
function HorizontalTimeline({ items, onOpen }: { items: Post[]; onOpen: (p: Post) => void }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<(HTMLElement | null)[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [showJump, setShowJump] = useState(false)

  // 平滑滚动控制器：维护目标 scrollLeft，每帧用 lerp 缓动逼近，
  // 模拟 index.html 里 ScrollTrigger scrub 的「丝滑」横向滚动手感。
  const targetRef = useRef(0)
  const rafRef = useRef(0)
  // 时间轴胶囊进入视口前，不拦截滚轮（放行页面竖向滚动）；进入后才接管横向滑帖。
  const pillRef = useRef<HTMLDivElement | null>(null)
  const gateRef = useRef(false)
  const stepTo = () => {
    const el = scrollRef.current
    if (!el) {
      rafRef.current = 0
      return
    }
    const cur = el.scrollLeft
    const diff = targetRef.current - cur
    if (Math.abs(diff) < 0.5) {
      el.scrollLeft = targetRef.current
      rafRef.current = 0
      return
    }
    el.scrollLeft = cur + diff * 0.12 // 缓动系数越小越「黏」
    rafRef.current = requestAnimationFrame(stepTo)
  }
  const animateScrollTo = (next: number) => {
    const el = scrollRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    targetRef.current = Math.max(0, Math.min(max, next))
    if (!rafRef.current) rafRef.current = requestAnimationFrame(stepTo)
  }

  // 滚动联动当前卡片
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let ticking = false
    const compute = () => {
      ticking = false
      const er = el.getBoundingClientRect()
      const lineX = er.left + er.width / 2
      let best = 0
      let bestDist = Infinity
      items.forEach((_, idx) => {
        const c = cardRefs.current[idx]
        if (!c) return
        const cr = c.getBoundingClientRect()
        const center = cr.left + cr.width / 2
        const dist = Math.abs(center - lineX)
        if (dist < bestDist) {
          bestDist = dist
          best = idx
        }
      })
      setActiveIndex(best)
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(compute)
    }
    compute()
    el.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      el.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [items.length])

  // 监听时间轴胶囊是否进入视口——决定滚轮是否接管横向滑帖。
  useEffect(() => {
    const pill = pillRef.current
    if (!pill) return
    const io = new IntersectionObserver(
      ([entry]) => {
        gateRef.current = entry.isIntersecting
      },
      { threshold: 0.6 },
    )
    io.observe(pill)
    return () => io.disconnect()
  }, [items.length])

  // 鼠标滚轮 → 平滑横向移动（走缓动控制器）；滚到两端时放行让页面正常上下滚
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // 时间轴胶囊还没滑进视口前，不接管——让页面正常竖向滚动直到看到胶囊。
      if (!gateRef.current) return
      // 取主轴增量，并把行/页单位换算成像素
      const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
      if (raw === 0) return
      let d = raw
      if (e.deltaMode === 1) d *= 16
      else if (e.deltaMode === 2) d *= el.clientWidth
      const max = el.scrollWidth - el.clientWidth
      // 非动画态时 target 可能与实际脱节（外部滚动过），先同步
      if (!rafRef.current) targetRef.current = el.scrollLeft
      const atStart = targetRef.current <= 0
      const atEnd = targetRef.current >= max - 1
      if ((d < 0 && atStart) || (d > 0 && atEnd)) return // 到端放行竖向滚动
      e.preventDefault()
      animateScrollTo(targetRef.current + d * 1.1)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [items.length])

  // 卸载时停掉可能在跑的 RAF
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const jumpTo = (idx: number) => {
    const el = scrollRef.current
    const c = cardRefs.current[idx]
    if (!el || !c) return
    const er = el.getBoundingClientRect()
    const cr = c.getBoundingClientRect()
    const delta = cr.left + cr.width / 2 - (er.left + er.width / 2)
    animateScrollTo(el.scrollLeft + delta)
  }

  const n = items.length
  const { start: navStart, len: navLen } = navWindow(activeIndex, n)
  const trackLen = (navLen - 1) * NODE_GAP
  const localActive = activeIndex - navStart
  const ratio = navLen <= 1 ? 0 : localActive / (navLen - 1)
  const activeTitle = items[activeIndex]?.title || ""
  const windowItems = items.slice(navStart, navStart + navLen)

  return (
    // PC 横版突破容器、占满整屏宽度（full-bleed）
    <div className="mx-[calc(50%-50vw)]">
      {/* 卡片横排：错落漂浮 + 进场高斯模糊渐入；滚轮驱动横向滚动 */}
      <div
        ref={scrollRef}
        className="flex gap-16 overflow-x-auto px-[calc(50vw_-_150px)] py-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((post, i) => {
          const dir = i % 2 ? -1 : 1
          const baseY = dir * (8 + (i % 3) * 5) // ±8 / 13 / 18
          const baseRot = dir * (2 + (i % 3)) // ±2 / 3 / 4 度
          // 进场动效挂到卡片本体（见 TimelineCard 注释）；外层 wrapper 只留布局与 ref、
          // 不做 opacity/filter，避免祖先合成层把卡片 backdrop-blur 锁掉 → 「雾→清」平滑渐入、不闪。
          return (
            <div
              key={post.id}
              ref={(el) => {
                cardRefs.current[i] = el
              }}
              className="shrink-0"
            >
              <TimelineCard
                post={post}
                onOpen={onOpen}
                className="w-[300px]"
                enter={{
                  initial: { opacity: 0, filter: "blur(16px)", y: baseY + 24, rotate: baseRot },
                  whileInView: { opacity: 1, filter: "blur(0px)", y: baseY, rotate: baseRot },
                  viewport: { once: false, margin: "0px 0px -8% 0px" },
                  transition: { duration: 0.65, ease: "easeOut" },
                }}
              />
            </div>
          )
        })}
      </div>

      {/* 底部横向胶囊时间轴 —— 仿玻璃 */}
      {n >= 2 && (
        <div ref={pillRef} className="mt-4 flex items-center justify-center gap-2">
          {/* pillWrap：相对定位锚点，承载「胶囊本体」+「悬浮标题气泡」两个兄弟。
              气泡放在 isolate 容器之外 —— 关键：带 backdrop-filter 的玻璃层会把
              「同一 stacking context 内、与它重叠的合成层」并进自己的模糊采样区域，
              而 Framer Motion 的 transform 动画让气泡成为独立合成层，于是模糊区域
              被向上撑出一个「帽子」。把玻璃层单独 isolate，气泡留在外层，二者不再合并。 */}
          <div className="relative">
            {activeTitle && (
              <div
                className="pointer-events-none absolute bottom-full z-10 mb-3 -translate-x-1/2 transition-[left] duration-300 ease-out"
                style={{ left: 20 + ratio * trackLen }}
              >
                <div className="relative">
                  {/* 实色气泡（不用 backdrop-blur，避免「头顶盖一层模糊」的突兀感）；溢出裁剪让标题从底部滑入 */}
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/80 px-4 py-2 text-[13px] text-white shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
                    <motion.span
                      key={activeIndex}
                      initial={{ y: "110%", opacity: 0 }}
                      animate={{ y: "0%", opacity: 1 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      className="block max-w-[44vw] truncate"
                    >
                      {activeTitle}
                    </motion.span>
                  </div>
                  {/* 朝下指向胶囊的小箭头 */}
                  <span className="absolute left-1/2 top-full h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-neutral-900/80" />
                </div>
              </div>
            )}
            {/* 胶囊本体：仿毛玻璃（半透明渐变 + 边框高光），不用 backdrop-filter，
                从根本上规避 Chromium「模糊采样区被上方气泡撑出帽子」的合成怪癖。 */}
            <div className="relative px-5 py-3">
              {/* 仿玻璃层：半透明白渐变 + 边框 + 顶部内高光；inset-0 + rounded-full 自裁剪 */}
              <div className="absolute inset-0 rounded-full border border-white/25 bg-gradient-to-b from-white/20 to-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.3)]" />
              <div className="relative flex h-4 items-center" style={{ width: trackLen }}>
                <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/30" />
                <div
                  className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-lime-400 transition-[width] duration-200"
                  style={{ width: ratio * trackLen }}
                />
                <div className="relative flex w-full items-center justify-between">
                  {windowItems.map((p, i) => {
                    const idx = navStart + i
                    return (
                      <TimelineNode
                        key={p.id}
                        active={idx === activeIndex}
                        passed={idx < activeIndex}
                        onClick={() => jumpTo(idx)}
                        label={`跳到第 ${idx + 1} 条`}
                        onGlass
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowJump(true)}
            title="点击跳转到指定条目"
            className="rounded-full border border-white/25 bg-gradient-to-b from-white/20 to-white/10 px-3.5 py-3 text-sm font-semibold tabular-nums text-lime-300 shadow-[0_10px_30px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] transition-transform hover:scale-105"
          >
            {activeIndex + 1}
          </button>
        </div>
      )}

      {showJump && (
        <JumpModal
          total={n}
          current={activeIndex + 1}
          onJump={(idx) => jumpTo(idx)}
          onClose={() => setShowJump(false)}
        />
      )}
    </div>
  )
}

// ───────── 网格视图（个人主页「我的帖子」用） ─────────
// 复用 TimelineCard 卡面，按响应式网格排列（移动 2 列 / 桌面 3 列），
// stagger 高斯模糊渐入。点开走父组件同一套详情弹窗 + 点赞逻辑。
function GridTimeline({
  items,
  onOpen,
  selectMode = false,
  selectedIds,
  onToggle,
}: {
  items: Post[]
  onOpen: (p: Post) => void
  selectMode?: boolean
  selectedIds?: Set<string>
  onToggle?: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      {items.map((post, i) => {
        const selected = selectedIds?.has(post.id) ?? false
        return (
          <div
            key={post.id}
            className={`relative rounded-[1.7rem] ${selectMode && selected ? "ring-2 ring-lime-400" : ""}`}
          >
            {/* 选择模式：点卡片走打勾（onToggle）而非打开详情；右上角勾选标记 */}
            <TimelineCard
              post={post}
              onOpen={selectMode && onToggle ? () => onToggle(post.id) : onOpen}
              enter={{
                initial: { opacity: 0, y: 18, filter: "blur(8px)" },
                whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
                viewport: { once: true, margin: "-40px" },
                transition: { duration: 0.45, ease: "easeOut", delay: Math.min(i * 0.05, 0.4) },
              }}
            />
            {selectMode && (
              <span
                className={`pointer-events-none absolute right-3 top-3 z-20 flex h-7 w-7 items-center justify-center rounded-full border-2 shadow-lg transition-colors ${
                  selected
                    ? "border-lime-400 bg-lime-400 text-black"
                    : "border-white/70 bg-black/40 text-transparent"
                }`}
              >
                <Check className="h-4 w-4" strokeWidth={3} />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ───────── 父组件：状态 + 详情弹窗，按断点切视图 ─────────
// layout="grid" → 个人主页网格；默认 "timeline" → 社交页响应式时间轴。
export default function PostTimeline({
  posts,
  layout = "timeline",
  selectable = false,
}: {
  posts: Post[]
  layout?: "timeline" | "grid"
  selectable?: boolean
}) {
  const { user, isAdmin } = useSimpleAuth()
  const { toast } = useToast()
  const isMobile = useIsMobile()
  const isDesktop = useIsDesktop()

  const [items, setItems] = useState<Post[]>(posts)
  useEffect(() => setItems(posts), [posts])

  const [active, setActive] = useState<Post | null>(null)
  const [open, setOpen] = useState(false)
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState(0)
  const [isLiking, setIsLiking] = useState(false)

  // 批量删除（仅 selectable 的网格用，如个人主页「我的帖子」）
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const exitSelect = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }
  const doDelete = async () => {
    if (deleting || selectedIds.size === 0) return
    setDeleting(true)
    const ids = Array.from(selectedIds)
    let ok = 0
    for (const id of ids) {
      try {
        const success = await deletePostWithUIUpdate(id, () => {})
        if (success) ok++
      } catch {
        /* 单条失败继续删其余 */
      }
    }
    setItems((prev) => prev.filter((p) => !selectedIds.has(p.id)))
    setDeleting(false)
    setConfirmOpen(false)
    exitSelect()
    toast({
      title: ok > 0 ? "删除完成" : "删除失败",
      description: ok > 0 ? `已删除 ${ok} 个帖子` : "请稍后重试",
      variant: ok > 0 ? undefined : "destructive",
    })
  }

  const openPost = async (post: Post) => {
    setActive(post)
    setLikeCount(post.likes_count || 0)
    setLiked(false)
    setOpen(true)
    if (user) {
      try {
        const l = await checkUserLiked(post.id, user.id)
        setLiked(!!l)
      } catch {
        /* 忽略：默认未点赞 */
      }
    }
  }

  const patchCount = (id: string, patch: Partial<Post>) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    setActive((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev))
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
      patchCount(active.id, { likes_count: newCount })
    } catch {
      setLiked(prevLiked)
      setLikeCount(prevCount)
      toast({ title: "操作失败", description: "点赞失败，请稍后重试", variant: "destructive" })
    } finally {
      setIsLiking(false)
    }
  }

  const handleCommentAdded = () => {
    if (!active) return
    patchCount(active.id, { comments_count: (active.comments_count || 0) + 1 })
  }

  return (
    <>
      {layout === "grid" ? (
        <>
          {selectable && items.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              {!selectMode ? (
                <button
                  type="button"
                  onClick={() => setSelectMode(true)}
                  className="ml-auto rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:border-lime-400/50 hover:text-lime-400"
                >
                  管理帖子
                </button>
              ) : (
                <>
                  <span className="text-sm text-white/60">已选 {selectedIds.size} 项</span>
                  <button
                    type="button"
                    onClick={exitSelect}
                    className="ml-auto rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/15"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(true)}
                    disabled={selectedIds.size === 0 || deleting}
                    className="inline-flex items-center gap-1.5 rounded-full bg-red-500/90 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除选中{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
                  </button>
                </>
              )}
            </div>
          )}
          <GridTimeline
            items={items}
            onOpen={openPost}
            selectMode={selectable && selectMode}
            selectedIds={selectedIds}
            onToggle={toggleSelect}
          />
        </>
      ) : isDesktop ? (
        <HorizontalTimeline items={items} onOpen={openPost} />
      ) : (
        <VerticalTimeline items={items} onOpen={openPost} />
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
          username={active.username || active.users?.username || "用户"}
          avatarUrl={active.users?.avatar_url || null}
          isMobile={isMobile}
          isAdmin={isAdmin}
        />
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除选中的 {selectedIds.size} 个帖子吗？此操作不可撤销，帖子的评论与点赞也会一并删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                doDelete()
              }}
              disabled={deleting}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleting ? "删除中…" : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
