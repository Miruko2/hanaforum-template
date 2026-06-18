"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { Loader2 } from "lucide-react"

interface DeleteConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  /** 删除进行中：滑块禁用并显示「删除中...」 */
  loading?: boolean
  /** 可选：被删对象的预览标题（如帖子标题）—— 极简版仅作 a11y 提示用 */
  title?: string
}

// ---------------------------------------------------------------------------
// 点阵渲染：5×7 字模（'1'=亮珠），用于轨道内提示文字；与注册弹窗 GLYPHS 同思路。
// 窄滑动条里中文点阵字模太复杂且糊，改用英文短词（SLIDE / DELETE / RELEASE），清晰且工业感统一。
// ---------------------------------------------------------------------------
const FONT_5x7: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
}

// 点阵垃圾桶图标：7 列 × 9 行。盖（顶部横条 + 提手）+ 桶身（梯形 + 竖纹）。
const TRASH_GLYPH = [
  "0011100",
  "0011100",
  "0111110",
  "1111111",
  "1001001",
  "1001001",
  "1010101",
  "1001001",
  "0111110",
]

/** 把字模数组渲染成点阵。cell=单个珠子直径，gap=珠间距，on/off 控制亮灭珠颜色。 */
function DotMatrix({
  glyph,
  cell = 2,
  gap = 1,
  onColor = "rgba(255, 220, 225, 0.95)",
  offColor = "transparent",
}: {
  glyph: string[]
  cell?: number
  gap?: number
  onColor?: string
  offColor?: string
}) {
  const cols = glyph[0].length
  const rows = glyph.length
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, ${cell}px)`,
        gridTemplateRows: `repeat(${rows}, ${cell}px)`,
        gap: `${gap}px`,
        lineHeight: 0,
      }}
    >
      {glyph.flatMap((row, r) =>
        row.split("").map((ch, c) => {
          const on = ch === "1"
          return (
            <span
              key={`${r}-${c}`}
              style={{
                width: cell,
                height: cell,
                borderRadius: "50%",
                background: on ? onColor : offColor,
                boxShadow: on ? `0 0 ${cell * 0.8}px ${onColor}` : "none",
              }}
            />
          )
        }),
      )}
    </div>
  )
}

/** 把一段英文渲染成横向排列的点阵字符（每字一个 5×7 块，字间留 1 列空）。 */
function DotText({
  text,
  cell = 2,
  gap = 1,
  charGap = 3,
  onColor,
}: {
  text: string
  cell?: number
  gap?: number
  charGap?: number
  onColor?: string
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: `${charGap}px` }}>
      {text.split("").map((ch, i) => {
        const g = FONT_5x7[ch.toUpperCase()]
        return g ? (
          <DotMatrix key={i} glyph={g} cell={cell} gap={gap} onColor={onColor} />
        ) : null
      })}
    </div>
  )
}

/**
 * 删除确认 · iOS 风滑动删除条（极简）。
 *
 * 不再是大卡片框，只有一根红色滑动条：滑块从左滑到右端（≥阈值）= 确认删除；
 * 未达阈值松手 = 回弹取消；点轨道外遮罩空白 = 关闭弹窗；ESC = 关闭。
 *
 * 视觉：危险红渐变 + 红色发光 + 毛玻璃底（与站点玻璃拟态语言一致）。
 * 装饰风格选「毛玻璃 + 发光」而非像素化——契合站点已有的 backdrop-filter 语言，
 * 红色 box-shadow 发光强化「删除」危险语义，且无逐帧动画、安卓 WebView 安全。
 *
 * ⚠️ 毛玻璃铁律：最外层 wrapper 只做布局，不挂 opacity 动画 / willChange:"opacity"，
 * 否则它会成为 backdrop root，废掉内部遮罩/滑条的 backdrop-filter。入场 opacity 淡入
 * 直接挂在【毛玻璃本体那一个元素上】（遮罩、滑条各自淡入）；同一元素上 backdrop-filter
 * 与 opacity/transform 合法共存。
 */
export default function DeleteConfirmDialog({
  open,
  onClose,
  onConfirm,
  loading = false,
  title,
}: DeleteConfirmDialogProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const knobRef = useRef<HTMLDivElement | null>(null)

  // 拖动几何状态（用 ref 存，避免每帧 setState 引发重渲染）
  const dragState = useRef({
    dragging: false,
    startX: 0,
    startLeft: 0,
    maxLeft: 0,
  })

  const [left, setLeft] = useState(0)
  const [maxLeft, setMaxLeft] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [noTransition, setNoTransition] = useState(false)

  const THRESHOLD = 0.85 // 拖到 85% 即视为确认（iOS 风偏严，防误触）
  const KNOB_PAD = 3

  // 打开时锁滚
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  // ESC 关闭（删除中 / 已确认时不允许）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading && !confirmed) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, loading, confirmed, onClose])

  // 弹窗每次打开时重置状态
  useEffect(() => {
    if (open) {
      setConfirmed(false)
      setLeft(KNOB_PAD)
      requestAnimationFrame(() => {
        const track = trackRef.current
        const knob = knobRef.current
        if (track && knob) {
          setMaxLeft(track.clientWidth - knob.clientWidth - KNOB_PAD * 2)
        }
      })
    }
  }, [open])

  // 窗口缩放时重算行程上限
  useEffect(() => {
    if (!open) return
    const onResize = () => {
      const track = trackRef.current
      const knob = knobRef.current
      if (track && knob) {
        const m = track.clientWidth - knob.clientWidth - KNOB_PAD * 2
        setMaxLeft(m)
        setLeft((prev) => Math.min(prev, m))
      }
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [open])

  const beginDrag = useCallback(
    (clientX: number) => {
      if (loading || confirmed) return
      const track = trackRef.current
      const knob = knobRef.current
      if (!track || !knob) return
      const m = track.clientWidth - knob.clientWidth - KNOB_PAD * 2
      dragState.current = { dragging: true, startX: clientX, startLeft: left, maxLeft: m }
      setMaxLeft(m)
      setNoTransition(true)
      setDragging(true)
    },
    [loading, confirmed, left],
  )

  const moveDrag = useCallback((clientX: number) => {
    if (!dragState.current.dragging) return
    const { startX, startLeft, maxLeft } = dragState.current
    const l = Math.max(KNOB_PAD, Math.min(maxLeft, startLeft + (clientX - startX)))
    setLeft(l)
  }, [])

  const endDrag = useCallback(() => {
    if (!dragState.current.dragging) return
    dragState.current.dragging = false
    setNoTransition(false)
    setDragging(false)
    const { maxLeft } = dragState.current
    const progress = maxLeft > 0 ? (left - KNOB_PAD) / (maxLeft - KNOB_PAD) : 0
    if (progress >= THRESHOLD) {
      setLeft(maxLeft)
      setConfirmed(true)
      onConfirm()
    } else {
      setLeft(KNOB_PAD)
    }
  }, [left, onConfirm])

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    beginDrag(e.clientX)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current.dragging) return
    moveDrag(e.clientX)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragState.current.dragging) return
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    endDrag()
  }

  const progress = maxLeft > 0 ? Math.max(0, Math.min(1, (left - KNOB_PAD) / (maxLeft - KNOB_PAD))) : 0
  const reachedThreshold = progress >= THRESHOLD

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {open && (
        /* 最外层 wrapper 只做布局：不挂 opacity 动画 / willChange:"opacity"，
           否则它会成为 backdrop root，废掉内部毛玻璃（见顶部注释）。 */
        <motion.div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          {/* 背景遮罩：毛玻璃常开，入场只淡入 opacity。点空白 = 关闭。 */}
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              background: "rgba(8, 8, 14, 0.28)",
              backdropFilter: "blur(14px) saturate(150%)",
              WebkitBackdropFilter: "blur(14px) saturate(150%)",
            }}
            onClick={() => {
              if (!loading && !confirmed) onClose()
            }}
          />

          {/* 极简：只有一根滑动条。点击不冒泡到遮罩（否则一点条就关闭）。 */}
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ type: "spring", stiffness: 360, damping: 28, mass: 0.7 }}
            style={{ width: "min(92vw, 420px)" }}
            role="alertdialog"
            aria-label={title ? `删除帖子「${title}」，滑动确认` : "滑动确认删除帖子"}
          >
            <div
              ref={trackRef}
              className="relative overflow-hidden rounded-full select-none"
              style={{
                height: 56,
                // 毛玻璃底 + 红色调
                background: "rgba(40, 14, 18, 0.5)",
                backdropFilter: "blur(18px) saturate(160%)",
                WebkitBackdropFilter: "blur(18px) saturate(160%)",
                border: "1px solid rgba(244, 63, 94, 0.4)",
                boxShadow:
                  "0 12px 40px rgba(0,0,0,0.45), 0 0 28px rgba(244,63,94,0.22), inset 0 1px 0 rgba(255,255,255,0.12)",
                touchAction: "none",
                cursor: loading || confirmed ? "default" : dragging ? "grabbing" : "grab",
              }}
            >
              {/* 进度填充：红色 LED 点阵 + 斜向流光遮罩来回扫动（参考注册弹窗 evg-btn 加载态）。
                  三层叠加：暗红底 → 红色点阵（radial 平铺）→ -55deg 斜向暗带遮罩流动。
                  background-position 用 alternate 来回扫，遮罩留出的透明窗在点阵上掠过形成流光。
                  宽度跟随滑块推进（left + 滑块宽），未滑过区域不渲染（width 控制）。 */}
              <div
                className="absolute left-0 top-0 bottom-0 pointer-events-none rounded-full dcg-fill"
                style={{
                  width: left + 50,
                  transition: noTransition ? "none" : "width 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)",
                }}
              />

              {/* 轨道内居中提示文字：点阵英文字体，与进度填充的点阵语言统一。
                  窄条内中文点阵糊且字模庞大，改用英文短词：SLIDE / RELEASE / DELETING。 */}
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{
                  opacity: confirmed ? 0 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                {loading ? (
                  <DotText text="DELETING" cell={2} gap={1} charGap={3} onColor="rgba(255,255,255,0.9)" />
                ) : reachedThreshold ? (
                  <DotText text="RELEASE" cell={2} gap={1} charGap={3} onColor="rgba(255,255,255,0.95)" />
                ) : (
                  <DotText text="SLIDE TO DELETE" cell={2} gap={1} charGap={3} onColor="rgba(255,210,215,0.85)" />
                )}
              </div>

              {/* 滑块 */}
              <div
                ref={knobRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className="absolute top-1/2 flex items-center justify-center rounded-full"
                style={{
                  left,
                  transform: "translateY(-50%)",
                  height: 46,
                  width: 46,
                  background: confirmed
                    ? "linear-gradient(135deg, #f43f5e, #be123c)"
                    : "linear-gradient(135deg, #fb7185, #e11d48)",
                  border: "1px solid rgba(255,255,255,0.35)",
                  color: "#fff",
                  boxShadow: dragging
                    ? "0 0 24px rgba(244,63,94,1), 0 4px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.4)"
                    : "0 0 16px rgba(244,63,94,0.7), 0 3px 10px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.35)",
                  transition: noTransition
                    ? "none"
                    : "left 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s, box-shadow 0.2s",
                  willChange: "left",
                  cursor: loading || confirmed ? "default" : "grab",
                  touchAction: "none",
                }}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.4} />
                ) : (
                  <DotMatrix glyph={TRASH_GLYPH} cell={2} gap={1} onColor="rgba(255,255,255,0.95)" />
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
