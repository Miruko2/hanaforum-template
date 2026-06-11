"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type Track } from "../_data/tracks"
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
import { useIsAndroid, useIsAndroidApp } from "../_lib/useIsAndroid"
import { usePlaybackWall, useTracks } from "../_context/PlaybackContext"
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

/**
 * 极轻量探针：订阅播放上下文，仅把"当前是否有曲目（即底部播放器是否显示）"
 * 通过回调上报。单独成组件，把 timeupdate 引发的高频 re-render 隔离在这里，
 * 不波及重量级的 MusicCanvas 本体（它只读 refs、不订阅播放状态）。
 */
function PlaybackPresenceProbe({
  onChange,
}: {
  onChange: (present: boolean) => void
}) {
  const { currentTrack } = usePlaybackWall()
  const present = currentTrack != null
  useEffect(() => {
    onChange(present)
  }, [present, onChange])
  return null
}

export function MusicCanvas({ onExpand, overlayOpen = false }: Props) {
  const reducedMotion = useReducedMotion()
  const isAndroid = useIsAndroid()
  // 安卓上有弹窗时退出渲染。其他平台 / 无弹窗时保持 canvas 显示。
  const hideForOverlay = isAndroid && overlayOpen
  // rAF 循环闭包依赖 [] 不重建，用 ref 让每帧读到最新 hideForOverlay。
  const hideForOverlayRef = useRef(false)
  hideForOverlayRef.current = hideForOverlay

  // ---- 安卓 app 底部播放器鬼影根治：遮挡播放器矩形区内的卡片 ----
  // 安卓 WebView 的合成器 bug 让 preserve-3d 卡片穿透、画到 z-60 底部播放器上
  // （封面附近方形鬼影/闪动）。纯 CSS（不透明背景 / 提层 / 封层）均压不住，唯一
  // 可靠手段是隐藏卡片本身（与弹窗 hideForOverlay 同理）。仅在「安卓 app + 正在
  // 播放（播放器可见）」时启用；rAF 循环每帧读该 ref，把落入播放器区的卡片
  // visibility:hidden。浏览器/iOS/桌面恒为 false，墙面完整不受影响。
  const isAndroidApp = useIsAndroidApp()
  const isAndroidAppRef = useRef(false)
  const trackPresentRef = useRef(false)
  const occludeForPlayerRef = useRef(false)
  useEffect(() => {
    isAndroidAppRef.current = isAndroidApp
    occludeForPlayerRef.current = isAndroidApp && trackPresentRef.current
  }, [isAndroidApp])
  const handleTrackPresence = useCallback((present: boolean) => {
    trackPresentRef.current = present
    occludeForPlayerRef.current = isAndroidAppRef.current && present
  }, [])
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

  // 运行时曲目源（用户自定义 / 精选默认墙）。来自低频上下文，不会被播放进度高频刷新。
  const tracks = useTracks()
  const pack = useMemo(
    () => packTracks(tracks, COLS, unitWidth, GAP),
    [tracks, unitWidth],
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
  // directly via usePlaybackWall(), so the canvas doesn't need to read it.

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

    // 底部播放器遮挡区（屏幕坐标；viewport 是 fixed inset-0，故与屏幕坐标一致）。
    // 高度 120 覆盖 bottom-5 边距 + 面板高度并留余量。
    //
    // 宽度取「整屏宽」而非播放器宽：播放器有 max-width:640，在宽屏（安卓平板）上居中、
    // 两侧留出大片空白；而安卓 WebView 的 preserve-3d 鬼影是沿「整条底边」出现的。
    // 旧版遮挡区只盖住中间 ~664px，平板上播放器两侧的底部角落便露出大量闪动鬼影。
    // 窄屏 / 缩小窗口时播放器近乎占满宽度、限宽遮挡区顺带盖住整条底边，故不复现 ——
    // 这正是用户反馈「屏幕缩小就不会出现」的根因。取整屏宽后遮住整条底部带、根除角落鬼影。
    // 仅当 occludeForPlayerRef 为真（安卓 app + 播放中）时用于隐藏落入此区的卡片。
    const PLAYER_ZONE_H = 120
    const playerZoneTop = viewSize.h - PLAYER_ZONE_H
    const playerZoneLeft = 0
    const playerZoneRight = viewSize.w

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
    // A1（静止停渲）：pan 停稳后整段跳过逐卡循环，省下每秒上千次空算 fisheye。
    //   paintSeq —— 可见集每次变化时自增（有新卡要画）。
    //   lastPainted —— 仅当某一帧把当前可见集"全部"卡片都写到了 DOM 才追平；
    //     setInstances 是异步挂载的，新卡可能晚一帧才出现，故未挂全就不追平，
    //     下一帧继续补画，保证不漏卡。
    //   prevOcclude —— 安卓 app 播放器遮挡态翻转时也要强制补一帧（即便 pan 没动）。
    let paintSeq = 0
    let lastPainted = -1
    let prevOcclude = false
    // 安卓 overlay 打开/关闭翻转时强制补一帧（把卡片整层写 hidden / 恢复）。
    let prevHide = false
    const prevStyle = new Map<
      string,
      { t: string; o: string; f: string; v: string; far: string }
    >()

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
          paintSeq++ // 可见集变了 → 需要(至少)一次逐卡重画，把新卡画出来
          // Prune style cache for cards that scrolled out of view.
          const live = new Set(cachedList.map((i) => i.key))
          for (const k of prevStyle.keys()) if (!live.has(k)) prevStyle.delete(k)
          queueMicrotask(() => {
            if (mounted) setInstances(cachedList)
          })
        }
      }

      // A1（静止停渲）：只有 pan 在动 / 可见集刚变 / 遮挡态翻转时才逐卡重写。
      // 三者皆否 = 墙面静止，本帧整段跳过（rAF 仍在转，但不再空算 fisheye）。
      const occludeNow = occludeForPlayerRef.current
      const hideNow = hideForOverlayRef.current
      const needPass =
        panMoved ||
        paintSeq !== lastPainted ||
        occludeNow !== prevOcclude ||
        hideNow !== prevHide

      if (needPass) {
        // 本帧是否把当前可见集的每张卡都画到了。异步挂载的新卡若还没出现，
        // 置 false → 不追平 lastPainted，下一帧继续补画。
        let allFound = true

        // Per-frame fisheye transforms via direct, dirty-checked DOM writes.
        for (const inst of cachedList) {
          const node = cardRefs.current.get(inst.key)
          if (!node) {
            allFound = false
            continue
          }
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
          // 模糊量化 → 字符串跨帧稳定 → 合成器复用已糊图层、不必每帧重栅格化。
          // 安卓：完全关闭 fisheye 景深模糊 —— filter:blur 在低端安卓 GPU 上是拖动时
          //   每卡每帧重栅格化的主要成本，小屏景深虚化肉眼难辨；3D 缩放/旋转/透视保留。
          // B1 iPhone(lite 非安卓)：0/1/2px 粗量化；桌面/iPad：0.5px 细腻模糊。
          let filter = ""
          if (!isAndroid && f.blur > 0.15) {
            if (lite) {
              const lb = Math.min(2, Math.round(f.blur))
              filter = lb > 0 ? `blur(${lb}px)` : ""
            } else {
              filter = `blur(${(Math.round(f.blur * 2) / 2).toFixed(1)}px)`
            }
          }

          // A2：外围卡整张已被鱼眼 filter:blur 糊过，其底部信息栏里那层 backdrop-blur
          // 此时根本看不见 —— 标记 data-far=1，用 CSS 关掉这层昂贵的 backdrop-filter，
          // 省下一大笔 GPU 重采样。中心清晰卡(far=0)保留毛玻璃。阈值 2.0px（鱼眼最大
          // 3.5px）：到这个糊度整卡已明显模糊，毛玻璃→实底的切换被完全盖住、看不出
          // 跳变；想更省把阈值调低、想更稳调高。
          const far = f.blur > 2.0 ? "1" : "0"

          // 安卓 app + 播放中：落入底部播放器矩形区的卡片整张隐藏，根除穿透鬼影。
          // 用未变换前的基础矩形 [sx,sy,w,h] 判定（鱼眼在边缘是缩小的，故略偏保守，
          // 利于完全遮住）。其余情形恒为 visible。
          const occluded =
            occludeNow &&
            sx < playerZoneRight &&
            sx + inst.card.width > playerZoneLeft &&
            sy + inst.card.height > playerZoneTop
          // 安卓 overlay 打开时整层卡片隐藏（防 preserve-3d 卡片穿透的鬼影）。
          // 必须写在「卡片自身」：Stage 父级的 visibility:hidden 会被这里每帧写的
          // 子级 visibility:visible 覆盖（visibility 可被子级逆转），故隐藏职责落到
          // rAF。不能改用 opacity 隐藏父层（<1 会扁平化 preserve-3d、整面墙跳位）。
          const visibility = hideNow || occluded ? "hidden" : "visible"

          const prev = prevStyle.get(inst.key)
          if (!prev) {
            node.style.transform = transform
            node.style.opacity = opacity
            node.style.filter = filter
            node.style.visibility = visibility
            if (node.dataset.far !== far) node.dataset.far = far
            prevStyle.set(inst.key, { t: transform, o: opacity, f: filter, v: visibility, far })
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
            if (prev.v !== visibility) {
              node.style.visibility = visibility
              prev.v = visibility
            }
            if (prev.far !== far) {
              node.dataset.far = far
              prev.far = far
            }
          }
        }

        if (allFound) lastPainted = paintSeq
        prevOcclude = occludeNow
        prevHide = hideNow
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
  }, [viewSize.w, viewSize.h, pack, lite, isAndroid])

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
      {/* 隔离播放状态订阅的轻量探针（返回 null，不渲染任何 DOM） */}
      <PlaybackPresenceProbe onChange={handleTrackPresence} />

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
          // 安卓 overlay 打开时隐藏卡片层（防 preserve-3d 卡片穿透、画到覆盖层
          // 上的鬼影）。只能用 visibility 瞬切，绝不能用 opacity 过渡 ——
          // opacity<1 是 CSS grouping property，按规范会把本元素的
          // transform-style 强制扁平化为 flat；安卓上 opacity∈[0,1) 的那一瞬
          // 卡片层被拍平、perspective 透视投影整体塌陷，表现为「整面墙一起
          // 跳位」（打开淡出 + 关闭淡入各塌一次，用户反馈）。visibility 不是
          // grouping property、不触发扁平化，瞬切隐藏/显示不动 3D 投影，根除跳位。
          // 代价：卡片由淡出变为瞬间隐藏/显示（被覆盖层入场掩盖，可接受）。
          // iPad/桌面 hideForOverlay 恒 false、opacity 恒 1，从不进入此路径。
          visibility: hideForOverlay ? "hidden" : "visible",
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
            android={isAndroid}
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
