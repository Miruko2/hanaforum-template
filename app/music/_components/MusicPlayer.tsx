"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Pause, Play, SkipBack, SkipForward, History as HistoryIcon, Heart, Repeat, Repeat1, Square } from "lucide-react"
import { usePlayback } from "../_context/PlaybackContext"
import { useDominantHue } from "../_lib/useDominantHue"
import { TrackCover } from "./TrackCover"
import { PlayModeMenu } from "./PlayModeMenu"
import type { Track } from "../_data/tracks"
import type { ExpandRect } from "./ExpandedCard"

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

type Props = {
  onToggleHistory: () => void
  onExpand: (track: Track, rect: ExpandRect) => void
}

export function MusicPlayer({ onToggleHistory, onExpand }: Props) {
  const { currentTrack, isPlaying, currentTime, duration, buffered, isFallback, togglePlay, seek, next, prev, isFavorite, toggleFavorite, playMode, setPlayMode } =
    usePlayback()
  const fav = currentTrack ? isFavorite(currentTrack.id) : false

  // Local scrub state — while user drags the progress bar we suppress the
  // external `currentTime` so the thumb doesn't jitter.
  // Use ref instead of state to avoid closure staleness in onBarUp/onBarMove.
  const scrubRef = useRef<number | null>(null)
  const [, setScrubTick] = useState(0) // dummy state to trigger re-render
  const barRef = useRef<HTMLDivElement | null>(null)

  // 播放模式上拉菜单。anchor 在点击时捕获（e.currentTarget），避免切歌时面板
  // 退场重挂导致 ref 被旧按钮卸载清空、菜单拿不到锚点的问题。
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [modeMenuAnchor, setModeMenuAnchor] = useState<HTMLElement | null>(null)
  // 切歌时关闭菜单，避免锚定到正在退场的旧按钮
  useEffect(() => {
    setModeMenuOpen(false)
  }, [currentTrack?.id])

  const visible = currentTrack !== null

  const computeTimeAt = useCallback(
    (clientX: number): number => {
      const el = barRef.current
      if (!el || !duration) return 0
      const r = el.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width))
      return pct * duration
    },
    [duration],
  )

  const onBarDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
      const t = computeTimeAt(e.clientX)
      scrubRef.current = t
      setScrubTick(v => v + 1) // trigger re-render to show scrub position
    },
    [computeTimeAt],
  )

  const onBarMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (scrubRef.current === null) return
      const t = computeTimeAt(e.clientX)
      scrubRef.current = t
      setScrubTick(v => v + 1) // trigger re-render
    },
    [computeTimeAt],
  )

  const onBarUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (scrubRef.current === null) return
      ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
      seek(scrubRef.current)
      scrubRef.current = null
      setScrubTick(v => v + 1)
    },
    [seek],
  )

  // Watch for ESC to dismiss focus styling on play button if needed
  useEffect(() => {
    /* placeholder — could add keybindings later */
  }, [])

  const shownT = scrubRef.current ?? currentTime
  const pct = duration ? (shownT / duration) * 100 : 0
  // 已缓冲（加载）进度，夹在 [当前播放, 100] 之间。
  const bufferedPct = duration ? Math.min(100, Math.max(pct, (buffered / duration) * 100)) : 0
  // Use the actual dominant cover color so the progress bar matches what the
  // expanded card shows. Falls back to the seeded random hue while extraction
  // is in flight or if it fails (e.g. CORS).
  // 用户自定义曲目：跳过 img-proxy 取色（避免服务端 fetch 任意 URL，SSRF 安全），
  // 直接用 id 哈希出的 hue。
  const extracted = useDominantHue(
    currentTrack?.userProvided ? null : currentTrack?.cover ?? null,
  )
  const hue = extracted ?? currentTrack?.hue ?? 0

  return (
    <div
      className="pointer-events-none fixed bottom-5 left-1/2 z-[60] w-[min(640px,calc(100vw-32px))] -translate-x-1/2"
    >
      <AnimatePresence mode="popLayout">
      {currentTrack && (
      <motion.div
        key={currentTrack.id}
        className="pointer-events-auto relative cursor-pointer overflow-hidden rounded-2xl p-2 pr-3 sm:p-3 sm:pr-4"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) =>
          onExpand(
            currentTrack,
            (e.currentTarget as HTMLDivElement).getBoundingClientRect(),
          )
        }
        // 全平台统一磨砂毛玻璃。鬼影靠外层独立合成层解决，与背景透明度无关，
        // 故不再按平台切不透明背景（实测不透明对鬼影零收益）。
        style={{
          background: "rgba(255,255,255,0.05)",
          backdropFilter: "blur(32px) saturate(140%)",
          WebkitBackdropFilter: "blur(32px) saturate(140%)",
          boxShadow:
            "0 20px 60px -10px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.12), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
        // Same Gaussian-blur condensation as ExpandedCard. Fires on initial
        // appearance AND on track change (because key={currentTrack.id} forces
        // an exit+enter cycle when the id changes).
        initial={{ opacity: 0, scale: 0.96, filter: "blur(20px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.96, filter: "blur(20px)" }}
        transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="relative flex items-center gap-2 sm:gap-3">
          {/* Cover */}
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl sm:h-14 sm:w-14">
            <TrackCover track={currentTrack} sizes="56px" />
          </div>

          {/* Info + progress */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold text-white flex items-center gap-1.5">
                  <span className="truncate">{currentTrack.title}</span>
                  {isFallback && (
                    <span
                      className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-medium text-white/70 tracking-wider"
                      title="音源暂不可用"
                    >
                      无音源
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-white/60">{currentTrack.artist}</div>
              </div>
              <div className="hidden shrink-0 text-[10px] tabular-nums text-white/60 sm:block">
                {fmtTime(shownT)} / {fmtTime(duration)}
              </div>
            </div>

            {/* Progress bar */}
            <div
              ref={barRef}
              className="mt-2 h-2 cursor-pointer rounded-full bg-white/10 relative touch-none"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={onBarDown}
              onPointerMove={onBarMove}
              onPointerUp={onBarUp}
              onPointerCancel={onBarUp}
            >
              {/* 已缓冲（加载）层：比底色亮、比播放进度暗，垫在播放进度之下 */}
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
                  background: `linear-gradient(90deg, hsl(${hue} 75% 65%), hsl(${
                    (hue + 30) % 360
                  } 80% 70%))`,
                }}
              />
              <div
                className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md ${
                  scrubRef.current === null
                    ? "transition-[left,opacity] duration-300 ease-linear"
                    : "transition-opacity"
                }`}
                style={{ left: `${pct}%`, opacity: scrubRef.current !== null ? 1 : 0.85 }}
              />
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-label="previous"
              className="h-8 w-8 grid place-items-center rounded-full text-white/80 hover:text-white hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation()
                prev()
              }}
            >
              <SkipBack size={16} />
            </button>
            <button
              type="button"
              aria-label={isPlaying ? "pause" : "play"}
              className="h-10 w-10 grid place-items-center rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-transform"
              onClick={(e) => {
                e.stopPropagation()
                togglePlay()
              }}
            >
              {isPlaying ? <Pause size={16} /> : <Play size={16} className="translate-x-[1px]" />}
            </button>
            <button
              type="button"
              aria-label="next"
              className="h-8 w-8 grid place-items-center rounded-full text-white/80 hover:text-white hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation()
                next()
              }}
            >
              <SkipForward size={16} />
            </button>
            <button
              type="button"
              aria-label="播放模式"
              aria-haspopup="menu"
              aria-expanded={modeMenuOpen}
              title={
                playMode === "one" ? "单曲循环" : playMode === "once" ? "播完就暂停" : "列表循环"
              }
              className="ml-1 h-8 w-8 grid place-items-center rounded-full hover:bg-white/10 transition-colors"
              // 三种模式都点亮为封面主色（与进度条左端色一致），用图标区分模式
              style={{ color: `hsl(${hue} 75% 65%)` }}
              onClick={(e) => {
                e.stopPropagation()
                setModeMenuAnchor(e.currentTarget)
                setModeMenuOpen((v) => !v)
              }}
            >
              {playMode === "one" ? (
                <Repeat1 size={15} />
              ) : playMode === "once" ? (
                <Square size={13} />
              ) : (
                <Repeat size={15} />
              )}
            </button>
            <button
              type="button"
              aria-label={fav ? "unlike" : "like"}
              className={`ml-1 hidden h-8 w-8 place-items-center rounded-full hover:bg-white/10 sm:grid ${
                fav ? "text-rose-400" : "text-white/60 hover:text-rose-300"
              }`}
              onClick={(e) => {
                e.stopPropagation()
                if (currentTrack) toggleFavorite(currentTrack.id)
              }}
            >
              <Heart size={14} fill={fav ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              aria-label="history"
              className="h-8 w-8 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/10"
              onClick={(e) => {
                e.stopPropagation()
                onToggleHistory()
              }}
            >
              <HistoryIcon size={14} />
            </button>
          </div>
        </div>
      </motion.div>
      )}
      </AnimatePresence>

      {modeMenuOpen && currentTrack && modeMenuAnchor && (
        <PlayModeMenu
          anchor={modeMenuAnchor}
          mode={playMode}
          onSelect={setPlayMode}
          onClose={() => setModeMenuOpen(false)}
        />
      )}
    </div>
  )
}
