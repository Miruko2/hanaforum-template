"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { X, Loader2, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface ImageLightboxProps {
  /** 单图直链；为 null/空时不展示灯箱（向后兼容） */
  src?: string | null
  /** 多图直链数组；非空时优先于 src，启用左右切换 + 圆点指示器 */
  images?: string[] | null
  /** 多图当前索引（受控） */
  index?: number
  /** 索引变化回调（滑动/箭头/键盘切换时） */
  onIndexChange?: (i: number) => void
  alt?: string
  onClose: () => void
}

/**
 * 图片灯箱：点击图片后在屏幕中心聚焦放大。
 *
 * - 单图：原图后台加载、解码完成后做「轻弹跳」入场（时序见下）。
 * - 多图：横向 scroll-snap 轮播，支持触摸滑动 / 桌面箭头 / 键盘左右，
 *   顶部显示「当前/总数」，底部圆点指示器（当前页为绿色椭圆）。
 *
 * portal 到 body：避开父容器的 overflow-hidden 裁切与 z-index 层叠陷阱，始终盖在最上层。
 */
export default function ImageLightbox({
  src,
  images,
  index = 0,
  onIndexChange,
  alt = "",
  onClose,
}: ImageLightboxProps) {
  // 归一化图片列表：多图优先，否则回退单图
  const list = (images && images.length ? images : src ? [src] : []).filter(Boolean) as string[]
  const open = list.length > 0
  const isMulti = list.length > 1

  // 原图是否加载完成 —— 决定单图何时触发弹入动画
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  // 多图轮播容器与当前索引
  const trackRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(index)
  // current 的 ref 镜像：滚轮处理器里按「当前页」做相对切换，避免闭包拿到旧值
  const currentRef = useRef(index)
  useEffect(() => {
    currentRef.current = current
  }, [current])
  // 程序化滚动期间忽略 onScroll 反写，避免与受控 index 抖动
  const lockScrollSync = useRef(false)
  // 记录按下位置，区分「轻点空白/图片（关闭）」与「滑动翻页（不关闭）」
  const tapStart = useRef<{ x: number; y: number } | null>(null)

  // 安卓 WebView：backdrop-filter 叠加父级 opacity 动画会撕裂 backing buffer。同步判定。
  const [isAndroid] = useState(
    () => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent),
  )
  // 安卓 app（Capacitor WebView）：单图入场去掉 scale 几何动画（首次大图栅格化 + 动画并发会撕裂）。
  const [isAndroidApp] = useState(() => {
    if (typeof navigator === "undefined" || typeof window === "undefined") return false
    const ua = navigator.userAgent
    return (/Android/.test(ua) && /wv|WebView/.test(ua)) || "Capacitor" in window
  })

  // ── 单图：解码后再弹入 ───────────────────────────────────────────────
  useEffect(() => {
    if (!open || isMulti) return
    setLoaded(false)
    let cancelled = false
    const reveal = () => {
      if (!cancelled) setLoaded(true)
    }
    const raf = requestAnimationFrame(() => {
      const el = imgRef.current
      if (!el) return
      if (typeof el.decode === "function") {
        el.decode().then(reveal).catch(reveal)
      } else if (el.complete && el.naturalWidth > 0) {
        reveal()
      } else {
        el.addEventListener("load", reveal, { once: true })
      }
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [open, isMulti, list[0]])

  // 打开时把内部索引同步到受控 index，并把轮播滚到对应页（无动画，避免开场滑动）
  useLayoutEffect(() => {
    if (!open || !isMulti) return
    setCurrent(index)
    const el = trackRef.current
    if (el) {
      lockScrollSync.current = true
      el.scrollLeft = index * el.clientWidth
      // 下一帧解锁滚动同步
      requestAnimationFrame(() => {
        lockScrollSync.current = false
      })
    }
    // 仅在打开/列表数量变化时复位；后续切换走 goTo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isMulti, list.length])

  // 切到第 i 张（带平滑滚动）
  const goTo = useCallback(
    (i: number) => {
      const el = trackRef.current
      if (!el) return
      const clamped = Math.max(0, Math.min(i, list.length - 1))
      el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" })
    },
    [list.length],
  )

  // PC 端：在灯箱图片上滚动鼠标滚轮 → 左右切换图片（竖向滚轮换算翻页）。
  // 原生非被动监听才能 preventDefault；加冷却避免一次滚动连跳多张；到边界不接管。
  useEffect(() => {
    const el = trackRef.current
    if (!open || !isMulti || !el) return
    let lock = false
    let acc = 0
    const STEP = 24
    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (delta === 0) return
      e.preventDefault()
      if (lock) return
      acc += delta
      if (Math.abs(acc) >= STEP) {
        const dir = acc > 0 ? 1 : -1
        acc = 0
        const target = currentRef.current + dir
        if (target < 0 || target > list.length - 1) return
        lock = true
        goTo(target)
        window.setTimeout(() => {
          lock = false
        }, 350)
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [open, isMulti, goTo, list.length])

  // 监听滚动，推导当前页
  const handleScroll = useCallback(() => {
    if (lockScrollSync.current) return
    const el = trackRef.current
    if (!el || el.clientWidth === 0) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    setCurrent((prev) => {
      if (i !== prev) onIndexChange?.(i)
      return i
    })
  }, [onIndexChange])

  // 键盘：Esc 关闭，左右切换
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (isMulti && e.key === "ArrowLeft") goTo(current - 1)
      else if (isMulti && e.key === "ArrowRight") goTo(current + 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, isMulti, current, goTo, onClose])

  if (typeof window === "undefined") return null

  // 单图入场动画：安卓 app 去几何动画，其余 spring 弹跳
  const imgAnim = isAndroidApp
    ? {
        initial: { opacity: 0 },
        animate: loaded ? { opacity: 1 } : { opacity: 0 },
        exit: { opacity: 0 },
        transition: { duration: 0 },
      }
    : {
        initial: { scale: 0.6, opacity: 0 },
        animate: loaded ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0 },
        exit: { scale: 0.5, opacity: 0 },
        transition: { type: "spring" as const, stiffness: 300, damping: 24, mass: 0.7 },
      }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          style={{
            background: "rgba(0,0,0,0.82)",
            backdropFilter: isAndroid ? undefined : "blur(10px)",
            WebkitBackdropFilter: isAndroid ? undefined : "blur(10px)",
          }}
        >
          {/* 关闭按钮 */}
          <motion.button
            type="button"
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            className="absolute top-4 right-4 z-20 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 hover:text-white"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.15 } }}
            exit={{ opacity: 0 }}
          >
            <X className="h-5 w-5" />
          </motion.button>

          {isMulti ? (
            <>
              {/* 计数（当前/总数） */}
              <motion.div
                className="absolute top-5 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-sm font-semibold text-white tabular-nums"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.15 } }}
                exit={{ opacity: 0 }}
              >
                {current + 1} / {list.length}
              </motion.div>

              {/* 横向 scroll-snap 轮播：滑动 / 箭头 / 键盘切换。
                  轻点（图片或两侧空白、非滑动）即关闭灯箱。 */}
              <div
                ref={trackRef}
                onScroll={handleScroll}
                onPointerDown={(e) => {
                  tapStart.current = { x: e.clientX, y: e.clientY }
                }}
                onClick={(e) => {
                  const s = tapStart.current
                  tapStart.current = null
                  // 仅在「几乎没移动」时视为轻点关闭，避免滑动翻页误关
                  if (s && Math.abs(e.clientX - s.x) < 10 && Math.abs(e.clientY - s.y) < 10) {
                    onClose()
                  }
                }}
                className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {list.map((url, i) => (
                  <div
                    key={i}
                    className="flex h-full w-full shrink-0 snap-center snap-always items-center justify-center p-4 sm:p-12"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={alt}
                      draggable={false}
                      decoding="async"
                      className="max-h-full max-w-full select-none rounded-2xl object-contain shadow-[0_30px_90px_-20px_rgba(0,0,0,0.8)]"
                    />
                  </div>
                ))}
              </div>

              {/* 左右箭头（仅 hover 设备显示，移动端靠滑动） */}
              <button
                type="button"
                aria-label="上一张"
                onClick={(e) => {
                  e.stopPropagation()
                  goTo(current - 1)
                }}
                className={cn(
                  "absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 grid h-11 w-11 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70 [@media(hover:hover)]:grid",
                  current === 0 && "pointer-events-none opacity-30",
                )}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                aria-label="下一张"
                onClick={(e) => {
                  e.stopPropagation()
                  goTo(current + 1)
                }}
                className={cn(
                  "absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 grid h-11 w-11 place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70 [@media(hover:hover)]:grid",
                  current === list.length - 1 && "pointer-events-none opacity-30",
                )}
              >
                <ChevronRight className="h-6 w-6" />
              </button>

              {/* 底部圆点指示器：当前页为绿色椭圆，其余为半透明小圆点 */}
              <div
                className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                {list.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`第 ${i + 1} 张`}
                    onClick={() => goTo(i)}
                    className={cn(
                      "h-2 rounded-full transition-all duration-300",
                      i === current ? "w-6 bg-lime-400" : "w-2 bg-white/45 hover:bg-white/70",
                    )}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              {/* 单图加载中 spinner */}
              {!loaded && (
                <Loader2 className="pointer-events-none absolute h-8 w-8 animate-spin text-white/70" />
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <motion.img
                ref={imgRef}
                src={list[0]}
                alt={alt}
                draggable={false}
                decoding="async"
                onClick={(e) => e.stopPropagation()}
                className="max-h-full max-w-full select-none rounded-2xl object-contain p-4 shadow-[0_30px_90px_-20px_rgba(0,0,0,0.8)] cursor-zoom-out sm:p-10"
                initial={imgAnim.initial}
                animate={imgAnim.animate}
                exit={imgAnim.exit}
                transition={imgAnim.transition}
              />
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
