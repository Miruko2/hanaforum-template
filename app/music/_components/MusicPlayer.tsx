"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Pause, Play, SkipBack, SkipForward, History as HistoryIcon, Heart, Repeat, Repeat1, Square } from "lucide-react"
import { usePlayback, usePlaybackTime } from "../_context/PlaybackContext"
import { useDominantHue } from "../_lib/useDominantHue"
import { useIsAndroidApp } from "../_lib/useIsAndroid"
import { TrackCover } from "./TrackCover"
import { PlayModeMenu } from "./PlayModeMenu"
import { VolumeControl } from "./VolumeControl"
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

// Progress bar sub-component with stable identity across track changes
// This ensures the ref stays valid even when the parent re-renders
function ProgressBar({
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
      const t = computeTimeAt(e.clientX)
      scrubRef.current = t
      setScrubTick(v => v + 1)
    },
    [computeTimeAt],
  )

  const onBarMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (scrubRef.current === null) return
      const t = computeTimeAt(e.clientX)
      scrubRef.current = t
      setScrubTick(v => v + 1)
    },
    [computeTimeAt],
  )

  const onBarUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (scrubRef.current === null) return
      ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
      onSeek(scrubRef.current)
      scrubRef.current = null
      setScrubTick(v => v + 1)
    },
    [onSeek],
  )

  const shownT = scrubRef.current ?? currentTime
  const pct = duration ? (shownT / duration) * 100 : 0
  const bufferedPct = duration ? Math.min(100, Math.max(pct, (buffered / duration) * 100)) : 0

  return (
    <div
      ref={barRef}
      className="h-2 cursor-pointer rounded-full bg-white/10 relative touch-none"
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
  )
}

export function MusicPlayer({ onToggleHistory, onExpand }: Props) {
  const { currentTrack, isPlaying, isFallback, togglePlay, seek, next, prev, isFavorite, toggleFavorite, playMode, setPlayMode, volume, setVolume } =
    usePlayback()
  const { currentTime, duration, buffered } = usePlaybackTime()
  const fav = currentTrack ? isFavorite(currentTrack.id) : false

  // 播放模式上拉菜单
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const [modeMenuAnchor, setModeMenuAnchor] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setModeMenuOpen(false)
  }, [currentTrack?.id])

  const handleSeek = useCallback(
    (t: number) => {
      seek(t)
    },
    [seek],
  )

  // Use the actual dominant cover color
  const extracted = useDominantHue(
    currentTrack?.userProvided ? null : currentTrack?.cover ?? null,
  )
  const hue = extracted ?? currentTrack?.hue ?? 0

  // Android WebView（app）：彻底去掉播放器的 backdrop-filter。
  // 它本来就是 85% 实底灰 + 背后卡片被遮挡（只剩暗化的封面背景），blur 的视觉
  // 贡献趋近于 0；但代价是真实的 —— 背景呼吸脉冲每变一次，整块面板都要重模糊
  // 一遍，还给本就脆弱的 WebView 合成器（鬼影史）多压一层。实底加深到 0.92 补偿。
  // 安卓 Chrome / iOS / 桌面不受影响，保留完整毛玻璃。
  // 走统一的 useIsAndroidApp（同步首帧正确 + Capacitor 全局检测 + 晚注入补查），
  // 不再单独内联一份更松的 UA 正则。它只驱动静态底色、不碰 framer-motion initial。
  const isAndroidWebView = useIsAndroidApp()

  return (
    <div
      className="pointer-events-none fixed bottom-5 left-1/2 z-[60] w-[min(640px,calc(100vw-32px))] -translate-x-1/2"
    >
      <AnimatePresence mode="popLayout">
      {currentTrack && (
      <motion.div
        key="player-container"
        className="pointer-events-auto relative cursor-pointer overflow-hidden rounded-2xl p-2 sm:p-3"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) =>
          onExpand(
            currentTrack,
            (e.currentTarget as HTMLDivElement).getBoundingClientRect(),
          )
        }
        style={{
          background: isAndroidWebView
            ? "rgba(40,40,40,0.92)" // Android app: near-solid（去 blur 后加深补偿，见上方注释）
            : "rgba(255,255,255,0.05)",
          backdropFilter: isAndroidWebView ? undefined : "blur(32px) saturate(140%)",
          WebkitBackdropFilter: isAndroidWebView ? undefined : "blur(32px) saturate(140%)",
          boxShadow:
            "0 20px 60px -10px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.12), inset 0 1px 0 rgba(255,255,255,0.08)",
          // GPU layer for Android to isolate rendering (avoid ghosting)
          transform: isAndroidWebView ? "translateZ(0)" : undefined,
          WebkitTransform: isAndroidWebView ? "translateZ(0)" : undefined,
          // Contain paint to prevent ghosting bleeding outside
          contain: isAndroidWebView ? "layout paint" : undefined,
        }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="relative flex flex-col gap-2">
          {/* 第一行：封面 + 曲名 + 控件 */}
          <div className="flex items-center gap-2 sm:gap-3">
          {/* Cover */}
          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl sm:h-14 sm:w-14">
            <TrackCover track={currentTrack} sizes="56px" />
          </div>

          {/* Info（进度条已移到第二行全宽，不再被控件挤压） */}
          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentTrack.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.3 }}
                className="min-w-0"
              >
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
              </motion.div>
            </AnimatePresence>
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
            <VolumeControl volume={volume} setVolume={setVolume} hue={hue} />
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

          {/* 第二行：横跨全宽的进度条 + 两端时间（不再被控件挤压） */}
          <div className="flex items-center gap-2">
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-white/55">
              {fmtTime(currentTime)}
            </span>
            <div className="min-w-0 flex-1">
              <ProgressBar
                duration={duration}
                buffered={buffered}
                currentTime={currentTime}
                hue={hue}
                onSeek={handleSeek}
              />
            </div>
            <span className="w-9 shrink-0 text-[10px] tabular-nums text-white/55">
              {fmtTime(duration)}
            </span>
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
