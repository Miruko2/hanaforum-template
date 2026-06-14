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
  /** 当前页变化回调（供父组件同步灯箱起始索引） */
  onIndexChange?: (i: number) => void
  /** 点击某张图片（用于打开灯箱），回传该图索引 */
  onImageClick?: (i: number) => void
  className?: string
}

// 单张轮播图：先试 640px 缩略图（省 egress），失败回退主图，再失败显错误态。
function CarouselSlide({ url, alt }: { url: string; alt: string }) {
  const [useFull, setUseFull] = useState(false)
  const [errored, setErrored] = useState(false)
  const thumb = postThumbUrl(url)
  const src = cdnUrl((!useFull && thumb) || url) || ""

  if (errored) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gray-800/60 text-gray-400">
        <ImageOff className="h-6 w-6" />
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      draggable={false}
      decoding="async"
      className="h-full w-full object-cover"
      onError={() => {
        if (!useFull && thumb) setUseFull(true)
        else setErrored(true)
      }}
    />
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
  onIndexChange,
  onImageClick,
  className,
}: PostImageCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState(0)
  // 记录按下位置，区分「点击放大」与「滑动翻页」
  const downX = useRef<number | null>(null)

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
            className="h-full w-full shrink-0 snap-center"
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
            <CarouselSlide url={url} alt={alt} />
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
