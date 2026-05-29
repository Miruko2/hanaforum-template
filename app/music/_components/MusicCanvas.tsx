"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { TRACKS, type Track } from "../_data/tracks"
import {
  computeInstances,
  fisheye,
  packTracks,
  type Instance,
} from "../_lib/canvas"
import { MusicCard } from "./MusicCard"
import type { ExpandRect } from "./ExpandedCard"
import { CoverBackdrop } from "./CoverBackdrop"
import { VideoBackdrop } from "./VideoBackdrop"
import { Grain } from "./Grain"
// Toggle between cover-image backdrop (per track) and a single looping video.
const USE_VIDEO_BACKDROP = true

// Layout knobs
const UNIT_W_DESKTOP = 180
const UNIT_W_MOBILE = 140
const GAP = 6
const COLS = 8
const FISHEYE_RADIUS_FACTOR = 0.38 // fraction of min(viewW, viewH) used as falloff radius
const PARALLAX_AMOUNT = 24 // px of background parallax (mouse-driven)
const PAN_LERP = 0.15 // glass-pane smoothing factor
const DRAG_INERTIA = 0.92

type Vec2 = { x: number; y: number }

type Props = {
  onExpand: (track: Track, rect: ExpandRect) => void
}

export function MusicCanvas({ onExpand }: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const parallaxRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // ---- Pan state ----
  // panTargetRef = where user input has accumulated (instant)
  // panRef        = visible position, lerps toward target each frame
  const panTargetRef = useRef<Vec2>({ x: 0, y: 0 })
  const panRef = useRef<Vec2>({ x: 0, y: 0 })
  const panVelRef = useRef<Vec2>({ x: 0, y: 0 })
  const dragRef = useRef<{
    active: boolean
    pointerId: number | null
    last: Vec2
    lastT: number
  }>({ active: false, pointerId: null, last: { x: 0, y: 0 }, lastT: 0 })

  // ---- Pointer (only for parallax, not fisheye) ----
  const pointerRef = useRef<Vec2>({ x: 0, y: 0 })

  // ---- Viewport ----
  const [viewSize, setViewSize] = useState({ w: 0, h: 0 })
  const isMobile = viewSize.w < 768
  const unitWidth = isMobile ? UNIT_W_MOBILE : UNIT_W_DESKTOP

  const pack = useMemo(
    () => packTracks(TRACKS, COLS, unitWidth, GAP),
    [unitWidth],
  )

  // Center the wall on first paint.
  const initialPanSet = useRef(false)
  useEffect(() => {
    if (!viewSize.w || !viewSize.h) return
    if (initialPanSet.current) return
    const cx = -pack.tileW / 2 + viewSize.w / 2
    const cy = -pack.tileH / 2 + viewSize.h / 2
    panTargetRef.current = { x: cx, y: cy }
    panRef.current = { x: cx, y: cy }
    pointerRef.current = { x: viewSize.w / 2, y: viewSize.h / 2 }
    initialPanSet.current = true
  }, [viewSize, pack.tileW, pack.tileH])

  // Visible instances — recomputed in rAF, setState only when key set changes.
  const [instances, setInstances] = useState<Instance[]>([])
  const instanceKeysRef = useRef<string>("")

  // Playback state lives in PlaybackContext; each MusicCard subscribes
  // directly via usePlayback(), so the canvas doesn't need to read it.

  // --- viewport size --- //
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setViewSize({ w: r.width, h: r.height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // --- pointer / drag handlers --- //
  const killDriftOnPress = useCallback(() => {
    // Pin smoothed pan to current visible position so a drifting card doesn't
    // slip out between pointerdown and pointerup (would suppress the click).
    panTargetRef.current = { x: panRef.current.x, y: panRef.current.y }
    panVelRef.current = { x: 0, y: 0 }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Buttons inside cards stop propagation themselves; this is just defense in
    // depth — never start a pan when the press lands on an interactive control.
    if ((e.target as HTMLElement).closest("button")) return

    if (e.button !== 0 && e.pointerType === "mouse") return
    dragRef.current = {
      active: true,
      pointerId: e.pointerId,
      last: { x: e.clientX, y: e.clientY },
      lastT: performance.now(),
    }
    panVelRef.current = { x: 0, y: 0 }
  }, [])

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    panTargetRef.current.y -= e.deltaY
    panTargetRef.current.x -= e.deltaX
  }, [])

  // --- window-level drag (no setPointerCapture) --- //
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = viewportRef.current?.getBoundingClientRect()
      if (r) {
        pointerRef.current.x = e.clientX - r.left
        pointerRef.current.y = e.clientY - r.top
      }

      const d = dragRef.current
      if (d.active && d.pointerId === e.pointerId) {
        const dx = e.clientX - d.last.x
        const dy = e.clientY - d.last.y
        d.last = { x: e.clientX, y: e.clientY }
        panTargetRef.current.x += dx
        panTargetRef.current.y += dy
        const now = performance.now()
        const dt = Math.max(1, now - d.lastT)
        panVelRef.current.x = dx / dt
        panVelRef.current.y = dy / dt
        d.lastT = now
      }
    }

    const onUp = (e: PointerEvent) => {
      const d = dragRef.current
      if (d.active && d.pointerId === e.pointerId) {
        d.active = false
        d.pointerId = null
        panVelRef.current.x *= 16
        panVelRef.current.y *= 16
      }
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onUp)
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onUp)
    }
  }, [])

  // --- main rAF loop --- //
  useEffect(() => {
    if (!viewSize.w || !viewSize.h) return

    let mounted = true
    let rafId = 0

    const focusX = viewSize.w / 2
    const focusY = viewSize.h / 2
    const radius = Math.min(viewSize.w, viewSize.h) * FISHEYE_RADIUS_FACTOR

    const loop = () => {
      if (!mounted) return

      // Inertia: apply remaining velocity to the TARGET (so lerp still smooths it).
      if (!dragRef.current.active) {
        const v = panVelRef.current
        if (Math.abs(v.x) > 0.05 || Math.abs(v.y) > 0.05) {
          panTargetRef.current.x += v.x
          panTargetRef.current.y += v.y
          v.x *= DRAG_INERTIA
          v.y *= DRAG_INERTIA
        }
      }

      // Glass-pane lerp: visible pan eases toward target.
      panRef.current.x += (panTargetRef.current.x - panRef.current.x) * PAN_LERP
      panRef.current.y += (panTargetRef.current.y - panRef.current.y) * PAN_LERP

      // Parallax: subtle counter-shift against pointer position.
      if (parallaxRef.current) {
        const nx = (pointerRef.current.x / viewSize.w) * 2 - 1
        const ny = (pointerRef.current.y / viewSize.h) * 2 - 1
        parallaxRef.current.style.transform = `translate3d(${-nx * PARALLAX_AMOUNT}px, ${
          -ny * PARALLAX_AMOUNT
        }px, 0)`
      }

      // Compute visible instance set; only setState when keys change.
      const list = computeInstances(
        pack,
        panRef.current.x,
        panRef.current.y,
        viewSize.w,
        viewSize.h,
      )
      const sig = list.map((i) => i.key).join("|")
      if (sig !== instanceKeysRef.current) {
        instanceKeysRef.current = sig
        queueMicrotask(() => {
          if (mounted) setInstances(list)
        })
      }

      // Per-frame fisheye transforms via direct DOM writes.
      for (const inst of list) {
        const node = cardRefs.current.get(inst.key)
        if (!node) continue
        const sx = inst.worldX + panRef.current.x
        const sy = inst.worldY + panRef.current.y
        const cx = sx + inst.card.width / 2
        const cy = sy + inst.card.height / 2
        const f = fisheye(cx, cy, focusX, focusY, radius)
        // Order matters: translate (in screen coords) THEN rotate (around card center) THEN scale.
        node.style.transform =
          `translate3d(${sx}px, ${sy}px, ${f.z}px) ` +
          `rotateX(${f.rotX.toFixed(2)}deg) rotateY(${f.rotY.toFixed(2)}deg) ` +
          `scale(${f.scale.toFixed(3)})`
        node.style.opacity = String(f.opacity)
        node.style.filter = f.blur > 0.15 ? `blur(${f.blur.toFixed(2)}px)` : ""
      }

      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => {
      mounted = false
      cancelAnimationFrame(rafId)
    }
  }, [viewSize.w, viewSize.h, pack])

  return (
    <div
      ref={viewportRef}
      onPointerDownCapture={killDriftOnPress}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      // Suppress the browser's native image-drag behavior — without this,
      // mouse-dragging on a card cover triggers the OS "drag this image"
      // ghost and conflicts with our pan logic.
      onDragStart={(e) => e.preventDefault()}
      className="fixed inset-0 z-50 overflow-hidden bg-black select-none touch-none cursor-grab active:cursor-grabbing"
      style={{
        perspective: 1600,
        perspectiveOrigin: "50% 50%",
      }}
    >
      {/* Ambient background — radial halo (kept faint as a fallback for the
          no-track state; the CoverBackdrop layer takes over the moment a
          track starts playing). */}
      <div
        ref={parallaxRef}
        className="pointer-events-none absolute inset-[-40px]"
        aria-hidden
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 50% 40%, rgba(40,80,160,0.18), rgba(0,0,0,0.95) 70%)",
          }}
        />
      </div>

      {/* Background — either looping mp4 or per-track cover backdrop */}
      {USE_VIDEO_BACKDROP ? <VideoBackdrop /> : <CoverBackdrop />}

      {/* δ — Film-grain shimmer over the backdrop */}
      <Grain />

      {/* Vignette overlay that subtly darkens the periphery */}
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        aria-hidden
        style={{
          background:
            "radial-gradient(70% 60% at 50% 50%, transparent 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Stage — pointer-events:none so its flat z=0 plane doesn't intercept
          hits meant for the cards (which sit at z<0 behind it in the preserve-3d
          space). Each card re-enables pointer-events on itself. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ transformStyle: "preserve-3d" }}
      >
        {instances.map((inst) => (
          <MusicCard
            key={inst.key}
            ref={(el) => {
              if (el) cardRefs.current.set(inst.key, el)
              else cardRefs.current.delete(inst.key)
            }}
            track={inst.card.track}
            width={inst.card.width}
            height={inst.card.height}
            onExpand={onExpand}
          />
        ))}
      </div>

      {/* Close */}
      <a
        href="/"
        aria-label="close"
        className="absolute top-4 right-4 z-10 h-9 w-9 grid place-items-center rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-colors backdrop-blur"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </a>

    </div>
  )
}
