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
import { useReducedMotion } from "../_lib/useReducedMotion"
import { useIsMobile } from "../_lib/useIsMobile"
import { useIsAndroid } from "../_lib/useIsAndroid"
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
  /**
   * 是否有覆盖层（ExpandedCard 或 HistoryPanel）当前打开。
   * 仅在 Android Chrome 上生效：弹窗期间整个 canvas 淡出 + visibility:hidden 退出渲染，
   * 规避 Chromium 安卓合成器的 `preserve-3d` z-index 排序 bug ——
   * 3D 上下文里的卡片会"逃出" stacking context、渲染在更高 z-index 的覆盖层上面，
   * 表现为透过不透明面板能看到卡片"鬼影"。
   * 桌面 / iOS / iPad 该属性被忽略，canvas 始终可见。
   */
  overlayOpen?: boolean
}

export function MusicCanvas({ onExpand, overlayOpen = false }: Props) {
  const reducedMotion = useReducedMotion()
  const isAndroid = useIsAndroid()
  // 安卓上有弹窗时退出渲染。其他平台 / 无弹窗时保持 canvas 显示。
  const hideForOverlay = isAndroid && overlayOpen
  // Distinct from the layout-driven `isMobile` (viewSize.w < 768) below —
  // this is a *device-tier* signal that drives perf degradation: when true
  // we drop the video backdrop, grain, parallax, and lighten the card blur.
  const mobileTier = useIsMobile()
  // `lite` collapses both reasons we'd want a stripped-down render into a
  // single boolean for the rAF loop / props below.
  const lite = reducedMotion || mobileTier
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

    // --- Per-frame work caches (perf) ---
    // The dominant cost is re-writing each card's transform/opacity/filter every
    // frame — especially `filter: blur()`, which forces a GPU re-render. We:
    //   1. skip recomputing the visible set + transforms when the pan hasn't
    //      moved (at rest the loop becomes a near no-op),
    //   2. dirty-check every style write (only touch the DOM when the value
    //      actually changes), and
    //   3. quantize blur to 0.5px steps so its string stays stable across many
    //      frames during slow motion — letting the compositor cache the blurred
    //      layer instead of re-rendering it. All visually lossless.
    let prevPanX = NaN
    let prevPanY = NaN
    let prevParallax = ""
    let cachedList: Instance[] = []
    const prevStyle = new Map<string, { t: string; o: string; f: string }>()

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

      // Parallax: subtle counter-shift against pointer position (dirty-checked).
      // Skipped on lite tier (reduced-motion OR mobile) — on phones there's no
      // mouse so the pointer position is just the last-tap location, and the
      // shift would barely move anyway.
      if (parallaxRef.current && !lite) {
        const nx = (pointerRef.current.x / viewSize.w) * 2 - 1
        const ny = (pointerRef.current.y / viewSize.h) * 2 - 1
        const ptf = `translate3d(${(-nx * PARALLAX_AMOUNT).toFixed(2)}px, ${(
          -ny * PARALLAX_AMOUNT
        ).toFixed(2)}px, 0)`
        if (ptf !== prevParallax) {
          parallaxRef.current.style.transform = ptf
          prevParallax = ptf
        }
      }

      const panX = panRef.current.x
      const panY = panRef.current.y
      const panMoved =
        Math.abs(panX - prevPanX) > 0.01 || Math.abs(panY - prevPanY) > 0.01

      // Recompute the visible set only when the pan actually moved. At rest
      // this avoids the per-frame array + signature-string allocation entirely.
      // Margin is left at the function's default (80): A/B-tested as the
      // single biggest perf win on this page, with no perceptible popping at
      // our drag velocities on either mobile or desktop.
      if (panMoved || cachedList.length === 0) {
        cachedList = computeInstances(pack, panX, panY, viewSize.w, viewSize.h)
        const sig = cachedList.map((i) => i.key).join("|")
        if (sig !== instanceKeysRef.current) {
          instanceKeysRef.current = sig
          // Prune style cache for cards that scrolled out of view.
          const live = new Set(cachedList.map((i) => i.key))
          for (const k of prevStyle.keys()) if (!live.has(k)) prevStyle.delete(k)
          queueMicrotask(() => {
            if (mounted) setInstances(cachedList)
          })
        }
      }

      // Per-frame fisheye transforms via direct, dirty-checked DOM writes.
      for (const inst of cachedList) {
        const node = cardRefs.current.get(inst.key)
        if (!node) continue
        const sx = inst.worldX + panX
        const sy = inst.worldY + panY
        const cx = sx + inst.card.width / 2
        const cy = sy + inst.card.height / 2
        const f = fisheye(cx, cy, focusX, focusY, radius)
        // Order matters: translate (screen coords) THEN rotate (around center) THEN scale.
        const transform =
          `translate3d(${sx.toFixed(2)}px, ${sy.toFixed(2)}px, ${f.z.toFixed(1)}px) ` +
          `rotateX(${f.rotX.toFixed(2)}deg) rotateY(${f.rotY.toFixed(2)}deg) ` +
          `scale(${f.scale.toFixed(3)})`
        const opacity = f.opacity.toFixed(3)
        // Quantize blur to 0.5px steps → stable string across frames → the
        // compositor can reuse the cached blurred layer instead of re-rendering.
        const filter =
          f.blur > 0.15 ? `blur(${(Math.round(f.blur * 2) / 2).toFixed(1)}px)` : ""

        const prev = prevStyle.get(inst.key)
        if (!prev) {
          node.style.transform = transform
          node.style.opacity = opacity
          node.style.filter = filter
          prevStyle.set(inst.key, { t: transform, o: opacity, f: filter })
        } else {
          if (prev.t !== transform) {
            node.style.transform = transform
            prev.t = transform
          }
          if (prev.o !== opacity) {
            node.style.opacity = opacity
            prev.o = opacity
          }
          if (prev.f !== filter) {
            node.style.filter = filter
            prev.f = filter
          }
        }
      }

      prevPanX = panX
      prevPanY = panY

      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)
    return () => {
      mounted = false
      cancelAnimationFrame(rafId)
    }
  }, [viewSize.w, viewSize.h, pack, lite])

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
        // 把整个画布封进自己的 GPU 合成层。preserve-3d 卡片在安卓 WebView 下会
        // 逃出本容器、画到 z-60 底部播放器之上（封面附近方形鬼影/闪动）。translateZ(0)
        // 让本层光栅化为单一纹理，3D 卡片只能在层内绘制、无法外溢，播放器即可干净叠加其上。
        // 注：perspective 属性作用于子级，与本元素自身 transform 互不影响，3D 鱼眼不受损。
        transform: "translateZ(0)",
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

      {/* Background — looping mp4 by default. Falls back to the static per-track
          cover backdrop on lite tier: phones can't decode the 1080p video at
          60fps, and users with prefers-reduced-motion explicitly want stillness. */}
      {USE_VIDEO_BACKDROP && !lite ? <VideoBackdrop /> : <CoverBackdrop lite={lite} />}

      {/* δ — Film-grain shimmer over the backdrop. Skipped on lite tier:
          imperceptible on small screens and a real cost on weak GPUs. */}
      {!lite && <Grain />}

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
          space). Each card re-enables pointer-events on itself.

          安卓覆盖层打开时，仅隐藏这个 3D Stage（卡片层）—— 外层 viewport
          的黑色背景 + VideoBackdrop/CoverBackdrop 视频背景照常保留，
          确保弹窗后面仍是 "music 页面的氛围底色"，不会穿到全局 layout
          露出首页背景 + 导航栏。
          只 hide 这一层就够了：preserve-3d 上下文是逃出 stacking context
          的元凶，把它退出渲染就根除问题。 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          transformStyle: "preserve-3d",
          opacity: hideForOverlay ? 0 : 1,
          visibility: hideForOverlay ? "hidden" : "visible",
          // visibility 延迟到 opacity 淡完才切，避免"瞬间消失"——
          // 关闭时 visibility 立刻 visible 再淡入
          transition:
            "opacity 200ms ease-out, visibility 0s linear " +
            (hideForOverlay ? "200ms" : "0s"),
        }}
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
            lite={lite}
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
