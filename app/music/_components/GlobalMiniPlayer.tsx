"use client"

import { useCallback, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Pause, Play, SkipBack, SkipForward, Heart, Repeat, Repeat1, Square } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import {
  effectiveRingPath,
  navigateWithTransition,
  ringDirection,
} from "@/lib/view-transition-nav"
import { usePlayback, usePlaybackTime, type PlayMode } from "../_context/PlaybackContext"
import { useDominantHue } from "../_lib/useDominantHue"
import { useIsAndroidApp } from "../_lib/useIsAndroid"
import { TrackCover } from "./TrackCover"

// 播放模式循环顺序：列表循环 → 单曲循环 → 播完暂停。
const MODE_ORDER: PlayMode[] = ["list", "one", "once"]
const MODE_LABEL: Record<PlayMode, string> = {
  list: "列表循环",
  one: "单曲循环",
  once: "播完就暂停",
}

/**
 * 可拖动进度条。逻辑照搬底部播放器 MusicPlayer 的 ProgressBar：
 * 指针按下/拖动用本地 scrubRef 即时跟手，松手才真正 seek；缓冲段与当前进度
 * 双层显示，hue 取自封面主色。所有指针事件 stopPropagation，避免冒泡到卡片
 * 触发「点卡片打开音乐页」。
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
 * PlaybackProvider 现在挂在全局（components/providers.tsx），所以从 music 页切走时
 * <audio> 与播放状态都保留、歌不断。本组件就是「歌还在放」的可见入口：
 *   · 仅在「有当前曲目」且「不在 /music 页」时出现（music 页有它自己的底部播放器）；
 *   · 复用底部播放器的毛玻璃卡片样式与交互（可拖进度条 / 收藏 / 播放模式）；
 *   · 点卡片回到 /music（带丝带转场）；各控件就地操作、不跳页。
 */
export function GlobalMiniPlayer() {
  const pathname = usePathname()
  const router = useRouter()
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

  // 与底部播放器一致：取封面主色驱动进度条/图标着色
  const extracted = useDominantHue(
    currentTrack?.userProvided ? null : currentTrack?.cover ?? null,
  )
  const hue = extracted ?? currentTrack?.hue ?? 0

  // 安卓 WebView：去 backdrop-filter，换近实底（同底部播放器策略，避免合成器鬼影）
  const isAndroidWebView = useIsAndroidApp()

  const fav = currentTrack ? isFavorite(currentTrack.id) : false

  const openMusicPage = useCallback(() => {
    const dir = ringDirection(effectiveRingPath(pathname || "", false), "/music")
    if (dir) navigateWithTransition(router, "/music", dir)
    else router.push("/music")
  }, [pathname, router])

  const cycleMode = useCallback(() => {
    const i = MODE_ORDER.indexOf(playMode)
    setPlayMode(MODE_ORDER[(i + 1) % MODE_ORDER.length])
  }, [playMode, setPlayMode])

  // music 页有自己的底部播放器，这里不重复出现
  const visible = !!currentTrack && pathname !== "/music"

  // 弹幕墙(/live) 是一整块 position:fixed inset-0、z-index:80 的不透明全屏面板，
  // 会盖住普通 z-[45] 的迷你卡片。故在 live 页把卡片层级抬到 live 墙之上（z-[85]，
  // 仍在 toast(100)/弹窗之下），并上移避开底部全宽的输入框。
  // 其他页面保持低层级（z-[45]，在移动端菜单 z-[55] 之下，菜单打开时不会被它穿出）。
  const onLive = pathname === "/live"
  const wrapperClass = onLive
    ? "pointer-events-none fixed bottom-24 left-4 z-[85] w-[min(360px,calc(100vw-96px))]"
    : "pointer-events-none fixed bottom-4 left-4 z-[45] w-[min(360px,calc(100vw-96px))]"

  return (
    <div className={wrapperClass}>
      <AnimatePresence mode="popLayout">
        {visible && currentTrack && (
          <motion.div
            key="mini-player"
            className="pointer-events-auto relative cursor-pointer overflow-hidden rounded-2xl p-2"
            role="button"
            aria-label={`正在播放 ${currentTrack.title}，点击打开音乐页`}
            onClick={openMusicPage}
            style={{
              background: isAndroidWebView ? "rgba(40,40,40,0.92)" : "rgba(255,255,255,0.05)",
              backdropFilter: isAndroidWebView ? undefined : "blur(32px) saturate(140%)",
              WebkitBackdropFilter: isAndroidWebView ? undefined : "blur(32px) saturate(140%)",
              boxShadow:
                "0 20px 60px -10px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.12), inset 0 1px 0 rgba(255,255,255,0.08)",
              transform: isAndroidWebView ? "translateZ(0)" : undefined,
              WebkitTransform: isAndroidWebView ? "translateZ(0)" : undefined,
              contain: isAndroidWebView ? "layout paint" : undefined,
            }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="flex items-center gap-2.5">
              {/* 封面 */}
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl">
                <TrackCover track={currentTrack} sizes="44px" />
              </div>

              {/* 曲名 / 歌手 */}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-white">
                  {currentTrack.title}
                </div>
                <div className="truncate text-[11px] text-white/55">{currentTrack.artist}</div>
              </div>

              {/* 控件：上一首 / 播放暂停 / 下一首 / 播放模式 / 收藏 */}
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
                <button
                  type="button"
                  aria-label={isPlaying ? "pause" : "play"}
                  className="grid h-9 w-9 place-items-center rounded-full bg-white text-black transition-transform hover:scale-105 active:scale-95"
                  onClick={(e) => {
                    e.stopPropagation()
                    togglePlay()
                  }}
                >
                  {isPlaying ? <Pause size={15} /> : <Play size={15} className="translate-x-[1px]" />}
                </button>
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
              </div>
            </div>

            {/* 底部可拖动进度条 */}
            <div className="mt-2 px-0.5">
              <MiniProgressBar
                duration={duration}
                buffered={buffered}
                currentTime={currentTime}
                hue={hue}
                onSeek={seek}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
