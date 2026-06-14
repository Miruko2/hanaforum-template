"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react"
import { cn } from "@/lib/utils"
import { cdnUrl } from "@/lib/cdn-url"
import { postThumbUrl } from "@/lib/post-image-thumb"

interface PostImageCarouselProps {
  /** 全部图片的 public 直链（封面在首位） */
  images: string[]
  alt?: string
  /** 横版详情：铺满父容器高度（h-full）；否则用固定高度（竖版/手机） */
  fillParent?: boolean
  /** 高清模式：当前查看的那张升级为主图(1920 webp)；其余仍用缩略图省 egress */
  fullRes?: boolean
  /** 当前页变化回调（供父组件同步灯箱起始索引） */
  onIndexChange?: (i: number) => void
  /** 点击某张图片（用于打开灯箱），回传该图索引 */
  onImageClick?: (i: number) => void
  className?: string
}

// 单张轮播图：双层交叉淡入。底层永远是缩略图（秒出占位），上层是主图，
// 主图加载完成后淡入覆盖——避免「换 src 重新解码」造成的「糊→清」闪烁。
// load=true 时才挂载主图层并触发其下载（用于当前张 + 预加载）。
function CarouselSlide({
  url,
  alt,
  load,
}: {
  url: string
  alt: string
  load: boolean
}) {
  const [fullLoaded, setFullLoaded] = useState(false)
  const [baseErrored, setBaseErrored] = useState(false)
  const thumb = cdnUrl(postThumbUrl(url))
  const full = cdnUrl(url) || ""
  // 有缩略图就拿它做底；没有就直接拿主图做底（此时无需上层）
  const base = thumb || full
  const needOverlay = load && !!full && !!thumb

  if (baseErrored && !full) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-800/60 text-gray-400">
        <ImageOff className="h-6 w-6" />
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={base}
        alt={alt}
        draggable={false}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        onError={() => setBaseErrored(true)}
      />
      {needOverlay && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={full}
          alt=""
          aria-hidden
          draggable={false}
          decoding="async"
          onLoad={() => setFullLoaded(true)}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ease-out",
            fullLoaded ? "opacity-100" : "opacity-0",
          )}
        />
      )}
    </div>
  )
}

/**
 * 帖子详情页多图轮播：横向 scroll-snap 轨道，原生触摸滑动（图片跟手左右移动），
 * 桌面端额外提供左右箭头，底部圆点指示器（当前页为绿色椭圆）。
 * 点击图片回调 onImageClick 打开灯箱看原图。
 *
 * 用原生横向滚动而非 framer drag：与全局左右切页手势（page-swipe）天然兼容
 * —— page-swipe 检测到祖先是可横向滚动容器时会自动让位，不会冲突。
 */
export default function PostImageCarousel({
  images,
  alt = "",
  fillParent = false,
  fullRes = false,
  onIndexChange,
  onImageClick,
  className,
}: PostImageCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(0)
  // current 的 ref 镜像：滚轮处理器里要按「当前页」做相对切换，避免闭包拿到旧值
  const currentRef = useRef(0)
  useEffect(() => {
    currentRef.current = current
  }, [current])
  // 高清预加载：详情打开后（错开首图、空闲时）后台把所有图的主图都预清晰化，
  // 这样滑到后面任意一张时主图早已就绪、直接显示清晰图，不再「糊一下」。
  const [prefetchAll, setPrefetchAll] = useState(false)
  // 记录按下位置，区分「点击放大」与「滑动翻页」
  const downX = useRef<number | null>(null)

  // 错峰预加载：先让当前张（封面）独享带宽，约 600ms 后再批量预清晰其余图。
  useEffect(() => {
    if (!fullRes || images.length <= 1) return
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    let idleId: number | undefined
    const timer = setTimeout(() => {
      if (typeof w.requestIdleCallback === "function") {
        idleId = w.requestIdleCallback(() => setPrefetchAll(true), { timeout: 3000 })
      } else {
        setPrefetchAll(true)
      }
    }, 600)
    return () => {
      clearTimeout(timer)
      if (idleId !== undefined && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleId)
      }
    }
  }, [fullRes, images.length])

  const handleScroll = useCallback(() => {
    const el = trackRef.current
    if (!el || el.clientWidth === 0) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    setCurrent((prev) => {
      if (i !== prev) onIndexChange?.(i)
      return i
    })
  }, [onIndexChange])

  const goTo = useCallback(
    (i: number) => {
      const el = trackRef.current
      if (!el) return
      const clamped = Math.max(0, Math.min(i, images.length - 1))
      el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" })
    },
    [images.length],
  )

  // 容器尺寸变化（如旋转/布局变动）时，保持停在当前页
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      el.scrollLeft = current * el.clientWidth
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [current])

  // PC 端：在图片区域滚动鼠标滚轮 → 左右切换图片（把竖向滚轮换算成翻页）。
  // 用原生非被动监听才能 preventDefault 阻止页面/模态竖向滚动；加冷却避免一次滚动连跳多张。
  // 触摸设备基本不触发 wheel，单图时不接管（让页面正常滚动）。
  useEffect(() => {
    const el = trackRef.current
    if (!el || images.length <= 1) return
    let lock = false
    let acc = 0
    const STEP = 24
    const onWheel = (e: WheelEvent) => {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (delta === 0) return
      // 接管滚轮：阻止详情页/页面竖向滚动，改为切图
      e.preventDefault()
      if (lock) return
      acc += delta
      if (Math.abs(acc) >= STEP) {
        const dir = acc > 0 ? 1 : -1
        acc = 0
        const target = currentRef.current + dir
        // 到边界就不再接管（保持原地，不连跳）
        if (target < 0 || target > images.length - 1) return
        lock = true
        goTo(target)
        window.setTimeout(() => {
          lock = false
        }, 350)
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [images.length, goTo])

  const heightClass = fillParent ? "h-full" : "h-[300px]"

  return (
    <div className={cn("relative w-full", heightClass, className)}>
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((url, i) => (
          <div
            key={i}
            className="h-full w-full shrink-0 snap-center snap-always"
            onPointerDown={(e) => {
              downX.current = e.clientX
            }}
            onClick={(e) => {
              // 仅在「几乎没移动」时视为点击放大，避免滑动误触
              const dx = downX.current == null ? 0 : Math.abs(e.clientX - downX.current)
              downX.current = null
              if (dx < 8) onImageClick?.(i)
            }}
          >
            <CarouselSlide url={url} alt={alt} load={fullRes && (i === current || prefetchAll)} />
          </div>
        ))}
      </div>

      {/* 桌面左右箭头（移动端靠滑动） */}
      <button
        type="button"
        aria-label="上一张"
        onClick={(e) => {
          e.stopPropagation()
          goTo(current - 1)
        }}
        className={cn(
          "absolute left-2 top-1/2 z-20 hidden -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/65 [@media(hover:hover)]:grid",
          current === 0 && "pointer-events-none opacity-0",
        )}
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label="下一张"
        onClick={(e) => {
          e.stopPropagation()
          goTo(current + 1)
        }}
        className={cn(
          "absolute right-2 top-1/2 z-20 hidden -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/65 [@media(hover:hover)]:grid",
          current === images.length - 1 && "pointer-events-none opacity-0",
        )}
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      {/* 底部圆点指示器：当前页为绿色椭圆 */}
      <div className="pointer-events-auto absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/30 px-2 py-1.5 backdrop-blur-sm">
        {images.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`第 ${i + 1} 张`}
            onClick={(e) => {
              e.stopPropagation()
              goTo(i)
            }}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              i === current ? "w-5 bg-lime-400" : "w-1.5 bg-white/55 hover:bg-white/80",
            )}
          />
        ))}
      </div>
    </div>
  )
}
