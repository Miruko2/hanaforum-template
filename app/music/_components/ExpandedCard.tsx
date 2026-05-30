"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import Image from "next/image"
import { Pause, Play, SkipBack, SkipForward, Heart, X } from "lucide-react"
import { TRACKS, type Track } from "../_data/tracks"
import { usePlayback } from "../_context/PlaybackContext"
import { useDominantHue } from "../_lib/useDominantHue"
import { useReducedMotion } from "../_lib/useReducedMotion"

/** Screen-space rect of the card that was clicked — used as flight start. */
export type ExpandRect = { left: number; top: number; width: number; height: number }
export type ExpandTarget = { track: Track; rect: ExpandRect } | null

// Below this viewport width the panel shrinks (smaller disk + tighter panel).
const COMPACT_VW = 480
const RING_PADDING = 8
const STROKE = 3

// rAF target: 30 s/revolution at 60 fps = 0.2°/frame
const TARGET_SPEED_DEG_PER_FRAME = 360 / (30 * 60)

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

/**
 * Vinyl-style now-playing overlay. Opens by flying out of the clicked card's
 * on-screen rect (records rect on click, animates x/y/scale/rotateY back to
 * identity), then settles into a horizontal panel: spinning vinyl on the left,
 * circular progress ring around it, transport on the right.
 */
export function ExpandedCard({ target, onClose }: { target: ExpandTarget; onClose: () => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [target, onClose])

  if (!mounted) return null
  return createPortal(
    <AnimatePresence>
      {target && <ExpandedInner key={target.track.id} target={target} onClose={onClose} />}
    </AnimatePresence>,
    document.body,
  )
}

function ExpandedInner({
  target,
  onClose,
}: {
  target: { track: Track; rect: ExpandRect }
  onClose: () => void
}) {
  const { currentTrack, isPlaying, currentTime, duration, isFallback, togglePlay, play, seek, isFavorite, toggleFavorite } =
    usePlayback()
  const [shown, setShown] = useState<Track>(target.track)
  const isCurrent = currentTrack?.id === shown.id
  const playing = isCurrent && isPlaying
  const reducedMotion = useReducedMotion()
  const fav = isFavorite(shown.id)

  // ---- Responsive sizing ----
  // Watch viewport width; below COMPACT_VW the panel + disk shrink so the
  // whole thing fits on a phone screen with breathing room on the sides.
  const [vw, setVw] = useState<number>(() =>
    typeof window === "undefined" ? 1024 : window.innerWidth,
  )
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])
  const compact = vw < COMPACT_VW
  const PANEL_W = compact ? Math.max(280, vw - 24) : 560
  const PANEL_H = compact ? 180 : 260
  const DISK_SIZE = compact ? 130 : 200
  const RING_R = DISK_SIZE / 2 + RING_PADDING
  const SVG_SIZE = RING_R * 2 + STROKE * 2
  const SVG_OFFSET = -(RING_PADDING + STROKE)

  // ---- Vinyl spin: rAF accumulator with speed lerping toward target ----
  // CSS infinite spin stops hard; we want it to coast a moment when paused.
  const diskRef = useRef<HTMLDivElement | null>(null)
  const angleRef = useRef(0)
  const speedRef = useRef(0)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      // Reduced-motion users: never spin the vinyl (still shows the cover,
      // just static).
      const wanted = playing && !reducedMotion ? TARGET_SPEED_DEG_PER_FRAME : 0
      const k = playing ? 0.06 : 0.018 // start fairly quickly, glide to stop
      speedRef.current += (wanted - speedRef.current) * k
      if (Math.abs(speedRef.current) > 0.0005 || playing) {
        angleRef.current = (angleRef.current + speedRef.current) % 360
        if (diskRef.current) {
          diskRef.current.style.transform = `rotate(${angleRef.current}deg)`
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, reducedMotion])

  // ---- Progress / scrub on the ring ----
  const dur = isCurrent ? duration || 0 : 0
  const [scrub, setScrub] = useState<number | null>(null)
  const shownT = scrub ?? (isCurrent ? currentTime : 0)
  const pct = dur ? Math.max(0, Math.min(1, shownT / dur)) : 0
  const ringC = 2 * Math.PI * RING_R

  const ringSvgRef = useRef<SVGSVGElement | null>(null)
  const angleToTime = useCallback(
    (clientX: number, clientY: number) => {
      const el = ringSvgRef.current
      if (!el || !dur) return 0
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      let a = Math.atan2(clientY - cy, clientX - cx) // -PI..PI, 0 = right
      a = (a + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI) // 0..2PI from top, clockwise
      return (a / (2 * Math.PI)) * dur
    },
    [dur],
  )
  const onRingDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isCurrent || !dur) return
    e.stopPropagation()
    ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
    setScrub(angleToTime(e.clientX, e.clientY))
  }
  const onRingMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (scrub === null) return
    setScrub(angleToTime(e.clientX, e.clientY))
  }
  const onRingUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (scrub === null) return
    seek(scrub)
    setScrub(null)
    try {
      ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const step = useCallback(
    (dir: 1 | -1) => {
      const idx = TRACKS.findIndex((t) => t.id === shown.id)
      if (idx < 0) return
      const t = TRACKS[(idx + dir + TRACKS.length) % TRACKS.length]
      setShown(t)
      play(t.id)
    },
    [shown.id, play],
  )

  // Cover-derived hue overrides the seeded random hue from playlist.json.
  // While extracting (undefined) or on failure (null) we fall back to shown.hue
  // so the UI never goes monochrome.
  const extracted = useDominantHue(shown.cover)
  const hue = extracted ?? shown.hue
  // Thumb position (only shown while scrubbing).
  const thumbAngle = pct * 2 * Math.PI - Math.PI / 2
  const thumbX = SVG_SIZE / 2 + RING_R * Math.cos(thumbAngle)
  const thumbY = SVG_SIZE / 2 + RING_R * Math.sin(thumbAngle)

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* Backdrop — dimmer only, no blur, so the canvas behind stays sharp. */}
      <div className="absolute inset-0 bg-black/55" />

      {/* Panel */}
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="relative z-[61] flex items-center gap-3 px-4 py-4 sm:gap-6 sm:px-6 sm:py-5"
        style={{
          width: PANEL_W,
          height: PANEL_H,
          borderRadius: 28,
          background: "rgba(255,255,255,0.05)",
          backdropFilter: "blur(32px) saturate(140%)",
          WebkitBackdropFilter: "blur(32px) saturate(140%)",
          boxShadow:
            "0 30px 90px -15px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.12), inset 0 1px 0 rgba(255,255,255,0.10)",
          transformOrigin: "center center",
        }}
        // Gaussian-blur condensation: panel materialises out of a blur — sits
        // visually inside the same magnifying-glass language as the frosted
        // backdrop. Cubic easing (not spring) so it lands quietly, no bounce.
        initial={{ opacity: 0, scale: 0.96, filter: "blur(20px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, scale: 0.96, filter: "blur(20px)" }}
        transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {/* Vinyl + progress ring */}
        <div
          className="relative shrink-0"
          style={{ width: DISK_SIZE, height: DISK_SIZE }}
        >
          {/* Progress ring (hit area sized to enable scrubbing on the band) */}
          <svg
            ref={ringSvgRef}
            width={SVG_SIZE}
            height={SVG_SIZE}
            viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
            className={`absolute ${isCurrent && dur ? "cursor-pointer" : "cursor-default"}`}
            style={{ top: SVG_OFFSET, left: SVG_OFFSET }}
            onPointerDown={onRingDown}
            onPointerMove={onRingMove}
            onPointerUp={onRingUp}
            onPointerCancel={onRingUp}
          >
            <circle
              cx={SVG_SIZE / 2}
              cy={SVG_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke="rgba(255,255,255,0.10)"
              strokeWidth={STROKE}
            />
            <circle
              cx={SVG_SIZE / 2}
              cy={SVG_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke={`hsl(${hue} 80% 65%)`}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={ringC}
              strokeDashoffset={ringC * (1 - pct)}
              transform={`rotate(-90 ${SVG_SIZE / 2} ${SVG_SIZE / 2})`}
              style={{
                transition:
                  scrub === null ? "stroke-dashoffset 0.18s linear" : "none",
                filter: `drop-shadow(0 0 6px hsl(${hue} 80% 60% / 0.55))`,
              }}
            />
            {scrub !== null && (
              <circle cx={thumbX} cy={thumbY} r={5.5} fill="white" />
            )}
          </svg>

          {/* Vinyl disk */}
          <div
            ref={diskRef}
            className="absolute inset-0 rounded-full overflow-hidden"
            style={{
              boxShadow:
                "0 14px 30px -6px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.06)",
              willChange: "transform",
            }}
          >
            <Image
              src={shown.cover}
              alt={shown.title}
              fill
              sizes="200px"
              className="object-cover"
              priority
            />
          </div>
        </div>

        {/* Right column */}
        <div className="relative flex min-w-0 flex-1 flex-col justify-between self-stretch py-1">
          {/* Title / artist / close */}
          <div className="min-w-0">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-base font-semibold leading-tight text-white sm:text-xl">
                  {shown.title}
                </div>
                <div className="mt-1 truncate text-xs text-white/65 sm:text-sm">
                  {shown.artist}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="close"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white sm:h-8 sm:w-8"
              >
                <X size={compact ? 14 : 16} />
              </button>
            </div>
            {isCurrent && isFallback && (
              <span
                className="mt-1.5 inline-block rounded-full bg-white/12 px-1.5 py-0.5 text-[9px] font-medium tracking-wider text-white/65"
                title="原音频不可用，播放占位音频"
              >
                占位
              </span>
            )}
          </div>

          {/* Time row */}
          <div className="flex items-center gap-1.5 text-[10px] tabular-nums text-white/55 sm:text-[11px]">
            <span>{fmt(shownT)}</span>
            <span className="opacity-50">/</span>
            <span>{fmt(dur)}</span>
          </div>

          {/* Transport */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-white/85">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="prev"
                className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/10 hover:text-white sm:h-9 sm:w-9"
              >
                <SkipBack size={compact ? 16 : 18} />
              </button>
              <button
                type="button"
                onClick={() => togglePlay(shown.id)}
                aria-label={playing ? "pause" : "play"}
                className="grid h-10 w-10 place-items-center rounded-full bg-white text-black shadow-lg transition-transform hover:scale-105 active:scale-95 sm:h-12 sm:w-12"
              >
                {playing ? (
                  <Pause size={compact ? 18 : 22} />
                ) : (
                  <Play size={compact ? 18 : 22} className="translate-x-[1px]" />
                )}
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="next"
                className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/10 hover:text-white sm:h-9 sm:w-9"
              >
                <SkipForward size={compact ? 16 : 18} />
              </button>
            </div>
            <button
              type="button"
              aria-label={fav ? "unlike" : "like"}
              onClick={() => toggleFavorite(shown.id)}
              className={`grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-white/10 sm:h-9 sm:w-9 ${
                fav ? "text-rose-400" : "text-white/55 hover:text-white"
              }`}
            >
              <Heart size={compact ? 16 : 18} fill={fav ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
