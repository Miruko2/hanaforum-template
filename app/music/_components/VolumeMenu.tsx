"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"

const MENU_W = 40
const MENU_H = 140 // 单滑块，更瘦更高

/**
 * 音量上拉菜单：从底部播放器的音量按钮上方弹出的磨砂毛玻璃菜单。
 * 纯竖直滑块（点击/拖动设档）。
 * portal 到 body：避开播放器面板的 overflow-hidden 裁切 + backdrop-filter 层叠陷阱；
 * 全屏透明遮罩兜底点击外部关闭。
 */
export function VolumeMenu({
  anchor,
  volume,
  muted,
  onVolumeChange,
  onClose,
}: {
  anchor: HTMLElement | null
  /** 当前音量档位 [0, 1] */
  volume: number
  /** 是否处于静音状态（与 volume 独立，仅影响视觉填充高度） */
  muted: boolean
  onVolumeChange: (v: number) => void
  onClose: () => void
}) {
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null)
  // pointer 事件相关
  const trackRef = useRef<HTMLDivElement | null>(null)
  const fillRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  // 用 ref 跟踪 pointerdown 时的坐标,以便释放 capture 后还能算档位
  const lastClientYRef = useRef<number | null>(null)
  const pendingVolumeRef = useRef<number | null>(null)
  const [localVolume, setLocalVolume] = useState(volume)
  const paintVolumeRef = useRef<(v: number) => void>(() => {})

  // 父级音量变化时同步到本地显示 + DOM（外部 setVolume 后能立即反映）。
  // 注意：拖动期间父级 volume 不会变（commit 才会），但作为兜底还是同步一下 DOM。
  useEffect(() => {
    if (draggingRef.current) return
    setLocalVolume(volume)
    paintVolumeRef.current(volume)
  }, [volume])

  useEffect(() => {
    if (!anchor) return
    const update = () => {
      const r = anchor.getBoundingClientRect()
      let left = r.left + r.width / 2 - MENU_W / 2
      left = Math.max(8, Math.min(left, window.innerWidth - MENU_W - 8))
      setPos({ bottom: window.innerHeight - r.top + 10, left })
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [anchor])

  // 把"客户端 y 坐标"映射到音量档位。
  // 滑块顶部 = 100%，底部 = 0%。点击轨道任意位置 → 直接跳到该档位。
  const computeVolumeAt = useCallback((clientY: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    if (r.height < 1) return 0
    // 越靠顶 = 越大。clamp 到 [0, 1]。
    const pct = 1 - (clientY - r.top) / r.height
    return Math.max(0, Math.min(1, pct))
  }, [])

  // 把档位直接写到原生 DOM 上,绕过 setState → 拖动期间零 React 重渲染。
  // 仅在静音时把视觉档位归零,localVolume 保留原档以便取消静音时恢复。
  const paintVolume = useCallback((v: number) => {
    const visual = muted ? 0 : v
    const pct = visual * 100
    if (fillRef.current) fillRef.current.style.height = `${pct}%`
    if (handleRef.current) handleRef.current.style.bottom = `calc(${pct}% - 7px)`
  }, [muted])

  // 同步最新 paintVolume 到 ref,让声明在前的 effect 能调到。
  useEffect(() => {
    paintVolumeRef.current = paintVolume
  }, [paintVolume])

  // 真正提交音量:更新 state + 通知父级(setVolume → <audio>.volume + localStorage)。
  // 拖动期间不调用,松手才调用一次。
  const commitVolume = useCallback(
    (v: number) => {
      setLocalVolume(v)
      onVolumeChange(v)
    },
    [onVolumeChange],
  )

  // 拖动中:只动 DOM,不通知父级。pendingVolumeRef 记下最新值,松手 commit。
  // 非拖动(滚轮 / 点击):直接 commit(滚轮"咔哒"一下语义就是改音量,不是拖)。
  const previewVolume = useCallback(
    (v: number) => {
      if (draggingRef.current) {
        pendingVolumeRef.current = v
        paintVolume(v)
      } else {
        commitVolume(v)
      }
    },
    [paintVolume, commitVolume],
  )

  const onTrackDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
      draggingRef.current = true
      lastClientYRef.current = e.clientY
      previewVolume(computeVolumeAt(e.clientY))
    },
    [previewVolume, computeVolumeAt],
  )

  const onTrackMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      lastClientYRef.current = e.clientY
      previewVolume(computeVolumeAt(e.clientY))
    },
    [previewVolume, computeVolumeAt],
  )

  const onTrackUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      lastClientYRef.current = null
      try {
        ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
      } catch {
        /* 偶发：元素已不在 DOM */
      }
      if (pendingVolumeRef.current !== null) {
        const v = pendingVolumeRef.current
        pendingVolumeRef.current = null
        commitVolume(v)
      }
    },
    [commitVolume],
  )

  // document 级兜底：pointer capture 失效（菜单 portal 边界、滚动切走焦点、触摸中途弹虚拟键盘等）
  // 仍能继续拖动。不依赖 setPointerCapture / 鼠标停留在 [data-track] 内。
  useEffect(() => {
    if (!pos) return
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      lastClientYRef.current = e.clientY
      // 直接走 previewVolume 的"拖动分支",因为 draggingRef=true
      paintVolumeRef.current(computeVolumeAt(e.clientY))
      pendingVolumeRef.current = computeVolumeAt(e.clientY)
    }
    const onUp = (e: PointerEvent) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      lastClientYRef.current = null
      if (pendingVolumeRef.current !== null) {
        const v = pendingVolumeRef.current
        pendingVolumeRef.current = null
        // commitVolume 走 onVolumeChange,不要直接走 commitVolume(v)
        // 因为它闭包了 onVolumeChange,需要 setLocalVolume + 通知父级
        setLocalVolume(v)
        onVolumeChange(v)
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
  }, [pos, computeVolumeAt, onVolumeChange])

  // 当前最新档位的 ref，wheel 在闭包里需要读到最新值（不依赖 deps 重绑）。
  const latestVolumeRef = useRef(volume)
  useEffect(() => {
    latestVolumeRef.current = muted ? 0 : localVolume
  }, [localVolume, muted])

  // 滚轮调音量：滚上 = 加大，滚下 = 减小。每"咔哒"步进 4%，上限 100%。
  // 取消默认页面滚动（菜单打开时鼠标停在轨道上滚动不应触发底层滚动）。
  const onTrackWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      // deltaY 标准化：不同设备 deltaMode 单位不同（DOM_DELTA_PIXEL=0 / LINE=1 / PAGE=2）。
      // LINE 模式下 1 行 ≈ 16px，统一折算成"px 等效"。
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      // 反向：滚轮向上（deltaY<0）= 音量增加
      const step = -delta / 1500 // 一次滚动 ~1.5k px 走完整档位
      const next = Math.max(0, Math.min(1, latestVolumeRef.current + step))
      previewVolume(next)
    },
    [previewVolume],
  )

  // 静音时填充归零（视觉表达"没声"），但 localVolume 保留原档位以备取消静音时恢复。
  const fillPct = (muted ? 0 : localVolume) * 100

  if (!pos) return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[68]"
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <motion.div
        className="fixed z-[69] flex items-center justify-center overflow-hidden rounded-2xl p-1.5 text-white"
        style={{
          bottom: pos.bottom,
          left: pos.left,
          width: MENU_W,
          height: MENU_H,
          transformOrigin: "bottom center",
          background: "rgba(255,255,255,0.08)",
          backdropFilter: "blur(32px) saturate(160%)",
          WebkitBackdropFilter: "blur(32px) saturate(160%)",
          boxShadow:
            "0 16px 48px -8px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.12)",
        }}
        initial={{ opacity: 0, y: 8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.2, 0.9, 0.3, 1] }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 竖直滑块轨道 —— 容器是宽 hit-target,w-3 滑块是视觉,事件挂在容器上拖动永不脱手 */}
        <div
          ref={trackRef}
          role="slider"
          aria-label="音量"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((muted ? 0 : localVolume) * 100)}
          tabIndex={0}
          className="relative h-full w-8 cursor-pointer touch-none"
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
          onPointerUp={onTrackUp}
          onPointerCancel={onTrackUp}
          onWheel={onTrackWheel}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 滑块视觉轨道（窄,12px,实际是进度条） */}
          <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 w-3 rounded-full bg-white/15">
            <div
              ref={fillRef}
              className="absolute inset-x-0 bottom-0 rounded-full bg-white/85"
              style={{ height: `${fillPct}%` }}
            />
            <div
              ref={handleRef}
              className="absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-white shadow"
              style={{ bottom: `calc(${fillPct}% - 7px)` }}
            />
          </div>
        </div>
      </motion.div>
    </>,
    document.body,
  )
}

