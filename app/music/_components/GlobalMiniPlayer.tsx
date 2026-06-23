"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  SkipBack,
  SkipForward,
  Heart,
  Repeat,
  Repeat1,
  Square,
  Minimize2,
} from "lucide-react"
import { MusicPlayButton } from "@/components/music-play-button"
import { usePathname } from "next/navigation"
import { usePlayback, usePlaybackTime, type PlayMode } from "../_context/PlaybackContext"
import { useDominantHue } from "../_lib/useDominantHue"
import { useIsAndroidApp } from "../_lib/useIsAndroid"
import { TrackCover } from "./TrackCover"
import { ExpandedCard, type ExpandTarget } from "./ExpandedCard"

// 播放模式循环顺序：列表循环 → 单曲循环 → 播完暂停。
const MODE_ORDER: PlayMode[] = ["list", "one", "once"]
const MODE_LABEL: Record<PlayMode, string> = {
  list: "列表循环",
  one: "单曲循环",
  once: "播完就暂停",
}

const COLLAPSE_KEY = "music-mini-collapsed-v1"

// ---- 尺寸常量 ----
const COVER = 44 // 封面边长（h-11 w-11）
const FULL_H = 76 // 展开态卡片高度：p-2(8*2) + 封面行 44 + mt-2(8) + 进度条 8
const COLLAPSED = 60 // 收起态：封面 44 + p-2(8*2)
// 收起态封面外的环形进度条（参考 ExpandedCard 黑胶环）
const RING_PAD = 4
const RING_STROKE = 3
const RING_R = COVER / 2 + RING_PAD // 26
const RING_SVG = RING_R * 2 + RING_STROKE * 2 // 58
const RING_C = 2 * Math.PI * RING_R
// 旋转速度：30s 一圈 @60fps = 0.2°/帧（与 ExpandedCard 一致）
const SPIN_PER_FRAME = 360 / (30 * 60)

/**
 * 可拖动进度条（展开态底部）。逻辑照搬底部播放器 MusicPlayer 的 ProgressBar。
 */
function MiniProgressBar({
  duration,
  buffered,
  currentTime,
  hue,
  onSeek,
}: {
  duration: number
  buffered: number
  currentTime: number
  hue: number
  onSeek: (t: number) => void
}) {
  const barRef = useRef<HTMLDivElement | null>(null)
  const scrubRef = useRef<number | null>(null)
  const [, setScrubTick] = useState(0)

  const computeTimeAt = useCallback(
    (clientX: number): number => {
      const el = barRef.current
      if (!el || !duration || !isFinite(duration) || duration <= 0) return 0
      const r = el.getBoundingClientRect()
      if (r.width < 1) return 0
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
      return pct * duration
    },
    [duration],
  )

  const onBarDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
      scrubRef.current = computeTimeAt(e.clientX)
      setScrubTick((v) => v + 1)
    },
    [computeTimeAt],
  )

  const onBarMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (scrubRef.current === null) return
      scrubRef.current = computeTimeAt(e.clientX)
      setScrubTick((v) => v + 1)
    },
    [computeTimeAt],
  )

  const onBarUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (scrubRef.current === null) return
      ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
      onSeek(scrubRef.current)
      scrubRef.current = null
      setScrubTick((v) => v + 1)
    },
    [onSeek],
  )

  const shownT = scrubRef.current ?? currentTime
  const pct = duration ? (shownT / duration) * 100 : 0
  const bufferedPct = duration ? Math.min(100, Math.max(pct, (buffered / duration) * 100)) : 0

  return (
    <div
      ref={barRef}
      className="relative h-2 cursor-pointer touch-none rounded-full bg-white/10"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={onBarDown}
      onPointerMove={onBarMove}
      onPointerUp={onBarUp}
      onPointerCancel={onBarUp}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-white/25 transition-[width] duration-300 ease-out"
        style={{ width: `${bufferedPct}%` }}
      />
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${
          scrubRef.current === null ? "transition-[width] duration-300 ease-linear" : ""
        }`}
        style={{
          width: `${pct}%`,
          background: `linear-gradient(90deg, hsl(${hue} 75% 65%), hsl(${(hue + 30) % 360} 80% 70%))`,
        }}
      />
      <div
        className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md ${
          scrubRef.current === null ? "transition-[left,opacity] duration-300 ease-linear" : "transition-opacity"
        }`}
        style={{ left: `${pct}%`, opacity: scrubRef.current !== null ? 1 : 0.85 }}
      />
    </div>
  )
}

/**
 * 全站后台续播的迷你音乐卡片。
 *
 * 两种形态（点卡片右上角「收起」按钮切换，状态持久化到 localStorage）：
 *   · 展开态：毛玻璃卡片 = 封面 + 曲名/歌手 + 控件(上一首/播放/下一首/模式/收藏) + 可拖进度条；
 *     点卡片本体弹出 ExpandedCard 详情页。
 *   · 收起态：卡片从右往左收缩，只剩封面；封面变圆盘旋转 + 外圈环形进度条（参考详情页黑胶）；
 *     点圆盘展开回卡片。
 */
export function GlobalMiniPlayer() {
  const pathname = usePathname()
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    next,
    prev,
    seek,
    isFavorite,
    toggleFavorite,
    playMode,
    setPlayMode,
  } = usePlayback()
  const { currentTime, duration, buffered } = usePlaybackTime()

  // 点卡片打开的「正在播放」详情页（复用 music 页的 ExpandedCard）。
  const [expand, setExpand] = useState<ExpandTarget>(null)

  // 收起态。初值从 localStorage 读，切换时写回。
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true)
    } catch {
      /* ignore */
    }
  }, [])
  const toggleCollapsed = useCallback((v: boolean) => {
    setCollapsed(v)
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0")
    } catch {
      /* ignore */
    }
  }, [])

  // 视口宽度（展开态卡片宽度随之自适应）。
  const [vw, setVw] = useState<number>(() =>
    typeof window === "undefined" ? 1024 : window.innerWidth,
  )
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  const fullW = Math.min(360, vw - 96)

  // 与底部播放器一致：取封面主色驱动进度条/图标着色（用户曲目封面也取色，见 useDominantHue）
  const extracted = useDominantHue(currentTrack?.cover ?? null)
  const hue = extracted ?? currentTrack?.hue ?? 0

  // 安卓 WebView：去 backdrop-filter，换近实底（同底部播放器策略，避免合成器鬼影）
  const isAndroidWebView = useIsAndroidApp()

  const fav = currentTrack ? isFavorite(currentTrack.id) : false

  // ---- 收起态封面旋转：rAF 累加角度，速度向目标 lerp（参考 ExpandedCard）----
  const diskRef = useRef<HTMLDivElement | null>(null)
  const angleRef = useRef(0)
  const speedRef = useRef(0)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      if (collapsed) {
        const wanted = isPlaying ? SPIN_PER_FRAME : 0
        speedRef.current += (wanted - speedRef.current) * (isPlaying ? 0.06 : 0.018)
        if (Math.abs(speedRef.current) > 0.0005 || isPlaying) {
          angleRef.current = (angleRef.current + speedRef.current) % 360
          if (diskRef.current) diskRef.current.style.transform = `rotate(${angleRef.current}deg)`
        }
      } else if (diskRef.current) {
        // 展开态：封面是方块，去掉残留旋转
        if (diskRef.current.style.transform) diskRef.current.style.transform = ""
        angleRef.current = 0
        speedRef.current = 0
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [collapsed, isPlaying])

  // 环形进度（收起态）
  const ringPct = duration > 0 ? Math.max(0, Math.min(1, currentTime / duration)) : 0

  // 点卡片本体 → 展开态打开详情页；收起态则先展开回卡片。
  const onCardClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (collapsed) {
        toggleCollapsed(false)
        return
      }
      if (!currentTrack) return
      const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
      setExpand({
        track: currentTrack,
        rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      })
    },
    [collapsed, currentTrack, toggleCollapsed],
  )

  // 切页或当前曲目清空时收起详情页（本组件常驻、不随路由卸载，需手动收起）。
  useEffect(() => {
    setExpand(null)
  }, [pathname])
  useEffect(() => {
    if (!currentTrack) setExpand(null)
  }, [currentTrack])

  const cycleMode = useCallback(() => {
    const i = MODE_ORDER.indexOf(playMode)
    setPlayMode(MODE_ORDER[(i + 1) % MODE_ORDER.length])
  }, [playMode, setPlayMode])

  // music 页有自己的底部播放器，这里不重复出现
  const visible = !!currentTrack && pathname !== "/music"

  // 弹幕墙(/live) 是一整块 position:fixed inset-0、z-index:80 的不透明全屏面板，
  // 会盖住普通 z-[45] 的迷你卡片。故在 live 页把卡片层级抬到 live 墙之上（z-[85]）。
  // 垂直位置：移动端保持底部（bottom-4，live 页 bottom-24 避开输入框）；
  // PC 端(md+)改到页面高度正中（top-1/2 + -translate-y-1/2，按自身高度居中，
  // 收起/展开高度变化时仍保持居中），水平仍贴左 left-4 不变。
  const onLive = pathname === "/live"
  const wrapperClass = onLive
    ? "pointer-events-none fixed left-4 z-[85] bottom-24 md:bottom-auto md:top-1/2 md:-translate-y-1/2"
    : "pointer-events-none fixed left-4 z-[45] bottom-4 md:bottom-auto md:top-1/2 md:-translate-y-1/2"

  const sizeW = collapsed ? COLLAPSED : fullW
  const sizeH = collapsed ? COLLAPSED : FULL_H
  const radius = collapsed ? COLLAPSED / 2 : 16

  // 卡片底色 / 阴影：展开态是毛玻璃 + 阴影；收起态全部透明化（只留封面圆盘 + 环形进度条
  // 裸浮在页面上，像黑胶），避免在深色页面上糊出一个难看的深色圆。阴影各层用同结构、
  // 收起态 alpha=0，让 framer 平滑淡出而不是硬切。backdrop-filter 无法动画，随收起态直接
  // 关掉（底色已同时淡到透明，肉眼无感）。
  const glassBg = isAndroidWebView ? "rgba(40,40,40,0.92)" : "rgba(255,255,255,0.05)"
  const cardBg = collapsed ? "rgba(255,255,255,0)" : glassBg
  const cardShadow = collapsed
    ? "0 20px 60px -10px rgba(0,0,0,0), 0 0 0 1px rgba(255,255,255,0), inset 0 1px 0 rgba(255,255,255,0)"
    : "0 20px 60px -10px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.12), inset 0 1px 0 rgba(255,255,255,0.08)"
  const useBlur = !collapsed && !isAndroidWebView

  return (
    <>
      <div className={wrapperClass}>
        <AnimatePresence mode="popLayout">
          {visible && currentTrack && (
            <motion.div
              key="mini-player"
              className="pointer-events-auto relative cursor-pointer overflow-hidden"
              role="button"
              aria-label={
                collapsed
                  ? `已收起：正在播放 ${currentTrack.title}，点击展开`
                  : `正在播放 ${currentTrack.title}，点击展开详情`
              }
              onClick={onCardClick}
              style={{
                backdropFilter: useBlur ? "blur(32px) saturate(140%)" : undefined,
                WebkitBackdropFilter: useBlur ? "blur(32px) saturate(140%)" : undefined,
                transform: isAndroidWebView ? "translateZ(0)" : undefined,
                WebkitTransform: isAndroidWebView ? "translateZ(0)" : undefined,
                contain: isAndroidWebView ? "layout paint" : undefined,
              }}
              initial={{
                opacity: 0,
                y: 20,
                width: sizeW,
                height: sizeH,
                borderRadius: radius,
                backgroundColor: cardBg,
                boxShadow: cardShadow,
              }}
              animate={{
                opacity: 1,
                y: 0,
                width: sizeW,
                height: sizeH,
                borderRadius: radius,
                backgroundColor: cardBg,
                boxShadow: cardShadow,
              }}
              exit={{ opacity: 0, y: 20 }}
              transition={{
                default: { duration: 0.42, ease: [0.2, 0.8, 0.2, 1] },
                opacity: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] },
              }}
            >
              {/* 内层固定内边距容器：宽度固定为展开态宽度，被外层 overflow 裁切，
                  收缩时内容自然从右侧被「卷」掉 */}
              <div
                className="absolute left-0 top-0 p-2"
                style={{ width: fullW }}
              >
                <div className="flex items-center gap-2.5">
                  {/* 封面（收起态变圆盘 + 旋转 + 环形进度） */}
                  <div className="relative shrink-0" style={{ width: COVER, height: COVER }}>
                    {/* 环形进度条：收起态淡入；居中套在封面外 */}
                    <motion.svg
                      width={RING_SVG}
                      height={RING_SVG}
                      viewBox={`0 0 ${RING_SVG} ${RING_SVG}`}
                      className="pointer-events-none absolute"
                      style={{ left: COVER / 2 - RING_SVG / 2, top: COVER / 2 - RING_SVG / 2 }}
                      initial={false}
                      animate={{ opacity: collapsed ? 1 : 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <circle
                        cx={RING_SVG / 2}
                        cy={RING_SVG / 2}
                        r={RING_R}
                        fill="none"
                        stroke="rgba(255,255,255,0.12)"
                        strokeWidth={RING_STROKE}
                      />
                      <circle
                        cx={RING_SVG / 2}
                        cy={RING_SVG / 2}
                        r={RING_R}
                        fill="none"
                        stroke={`hsl(${hue} 80% 65%)`}
                        strokeWidth={RING_STROKE}
                        strokeLinecap="round"
                        strokeDasharray={RING_C}
                        strokeDashoffset={RING_C * (1 - ringPct)}
                        transform={`rotate(-90 ${RING_SVG / 2} ${RING_SVG / 2})`}
                        style={{
                          transition: "stroke-dashoffset 0.2s linear",
                          filter: `drop-shadow(0 0 5px hsl(${hue} 80% 60% / 0.5))`,
                        }}
                      />
                    </motion.svg>

                    {/* 封面裁切框：收起态变圆形 */}
                    <motion.div
                      className="absolute inset-0 overflow-hidden"
                      initial={false}
                      animate={{ borderRadius: collapsed ? COVER / 2 : 12 }}
                      transition={{ duration: 0.42, ease: [0.2, 0.8, 0.2, 1] }}
                      style={{
                        // 收起态只留一条极淡描边，不要外阴影——否则会被卡片圆形裁成同心暗环，
                        // 糊在圆盘与进度环之间的空隙里（正是要去掉的「圆环背景」）。空隙保持透明。
                        boxShadow: collapsed ? "inset 0 0 0 1px rgba(255,255,255,0.10)" : undefined,
                      }}
                    >
                      {/* 旋转层：rAF 直接写 transform */}
                      <div ref={diskRef} className="absolute inset-0" style={{ willChange: "transform" }}>
                        <TrackCover track={currentTrack} sizes="44px" />
                      </div>
                    </motion.div>
                  </div>

                  {/* 曲名/歌手 + 控件（收起态淡出并被裁切） */}
                  <motion.div
                    className="flex min-w-0 flex-1 items-center gap-2.5"
                    animate={{ opacity: collapsed ? 0 : 1 }}
                    transition={{ duration: 0.2 }}
                    style={{ pointerEvents: collapsed ? "none" : "auto" }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-white">
                        {currentTrack.title}
                      </div>
                      <div className="truncate text-[11px] text-white/55">{currentTrack.artist}</div>
                    </div>

                    {/* 控件 */}
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        aria-label="previous"
                        className="grid h-7 w-7 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation()
                          prev()
                        }}
                      >
                        <SkipBack size={14} />
                      </button>
                      <MusicPlayButton
                        playing={isPlaying}
                        size={36}
                        hue={hue}
                        onClick={(e) => {
                          e.stopPropagation()
                          togglePlay()
                        }}
                      />
                      <button
                        type="button"
                        aria-label="next"
                        className="grid h-7 w-7 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation()
                          next()
                        }}
                      >
                        <SkipForward size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label="播放模式"
                        title={MODE_LABEL[playMode]}
                        className="ml-0.5 grid h-7 w-7 place-items-center rounded-full hover:bg-white/10"
                        style={{ color: `hsl(${hue} 75% 65%)` }}
                        onClick={(e) => {
                          e.stopPropagation()
                          cycleMode()
                        }}
                      >
                        {playMode === "one" ? (
                          <Repeat1 size={14} />
                        ) : playMode === "once" ? (
                          <Square size={12} />
                        ) : (
                          <Repeat size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={fav ? "unlike" : "like"}
                        className={`grid h-7 w-7 place-items-center rounded-full hover:bg-white/10 ${
                          fav ? "text-rose-400" : "text-white/60 hover:text-rose-300"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (currentTrack) toggleFavorite(currentTrack.id)
                        }}
                      >
                        <Heart size={13} fill={fav ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        aria-label="收起"
                        title="收起"
                        className="grid h-7 w-7 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleCollapsed(true)
                        }}
                      >
                        <Minimize2 size={13} />
                      </button>
                    </div>
                  </motion.div>
                </div>

                {/* 底部可拖动进度条（收起态淡出并被裁切） */}
                <motion.div
                  className="mt-2 px-0.5"
                  animate={{ opacity: collapsed ? 0 : 1 }}
                  transition={{ duration: 0.2 }}
                  style={{ pointerEvents: collapsed ? "none" : "auto" }}
                >
                  <MiniProgressBar
                    duration={duration}
                    buffered={buffered}
                    currentTime={currentTime}
                    hue={hue}
                    onSeek={seek}
                  />
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 正在播放详情页（复用 music 页 ExpandedCard）。live 页层级抬到弹幕墙(z-80)之上。 */}
      <ExpandedCard target={expand} onClose={() => setExpand(null)} overlayZ={onLive ? 90 : 60} />
    </>
  )
}
