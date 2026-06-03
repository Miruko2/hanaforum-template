"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { Repeat, Repeat1, Square } from "lucide-react"
import type { PlayMode } from "../_context/PlaybackContext"

const OPTIONS: { mode: PlayMode; title: string; Icon: typeof Repeat }[] = [
  { mode: "list", title: "列表循环", Icon: Repeat },
  { mode: "one", title: "单曲循环", Icon: Repeat1 },
  { mode: "once", title: "播完就暂停", Icon: Square },
]

const MENU_W = 44

/**
 * 播放模式上拉菜单：从底部播放器的模式按钮上方弹出的磨砂毛玻璃菜单。
 * 竖排纯图标（hover tooltip 提供文字说明）。
 * portal 到 body：避开播放器面板的 overflow-hidden 裁切 + backdrop-filter 层叠陷阱；
 * 全屏透明遮罩兜底点击外部关闭（也避免误触发面板展开）。
 */
export function PlayModeMenu({
  anchor,
  mode,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement | null
  mode: PlayMode
  onSelect: (m: PlayMode) => void
  onClose: () => void
}) {
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null)

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

  if (!pos) return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[68]"
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <motion.div
        className="fixed z-[69] flex flex-col gap-0.5 overflow-hidden rounded-2xl p-1 text-white"
        style={{
          bottom: pos.bottom,
          left: pos.left,
          width: MENU_W,
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
      >
        {OPTIONS.map(({ mode: m, title, Icon }) => {
          const active = m === mode
          return (
            <button
              key={m}
              type="button"
              title={title}
              aria-label={title}
              onClick={() => {
                onSelect(m)
                onClose()
              }}
              className={`grid h-9 w-9 place-items-center rounded-xl transition-colors ${
                active
                  ? "bg-white/[0.15] text-white"
                  : "text-white/55 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              <Icon size={16} />
            </button>
          )
        })}
      </motion.div>
    </>,
    document.body,
  )
}
