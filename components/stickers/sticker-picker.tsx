"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Smile } from "lucide-react"
import { cn } from "@/lib/utils"
import { STICKERS } from "@/lib/stickers"
import { StickerImage } from "./sticker-image"

interface StickerPickerProps {
  onSelect: (name: string) => void
  disabled?: boolean
  className?: string
  /** 弹出面板水平对齐：按钮在左用 left，在右用 right */
  align?: "left" | "right"
}

/**
 * 表情包选择器：一个笑脸按钮 + 弹出的表情网格，点选回调 onSelect(name)。
 * 复用聊天窗同款表情资源，外观走站点深色 + lime 玻璃风。
 * 面板向上弹出（bottom-full），适配「输入栏在底部」的发帖/评论场景。
 */
export function StickerPicker({ onSelect, disabled, className, align = "left" }: StickerPickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 点击/触摸面板外部时收起
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    document.addEventListener("touchstart", handler)
    return () => {
      document.removeEventListener("mousedown", handler)
      document.removeEventListener("touchstart", handler)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-label="表情包"
        aria-expanded={open}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-white/10 hover:text-lime-400 disabled:cursor-not-allowed disabled:opacity-50",
          open && "bg-white/10 text-lime-400",
        )}
      >
        <Smile className="h-5 w-5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 8 }}
            transition={{ type: "spring", stiffness: 400, damping: 25, mass: 0.8 }}
            style={{ transformOrigin: align === "right" ? "bottom right" : "bottom left" }}
            className={cn(
              "absolute bottom-full z-50 mb-2 grid w-[232px] grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-[#15171b]/95 p-3 shadow-2xl backdrop-blur-xl",
              align === "right" ? "right-0" : "left-0",
            )}
          >
            {STICKERS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  onSelect(name)
                  setOpen(false)
                }}
                aria-label={name}
                className="flex aspect-square items-center justify-center rounded-xl bg-white/[0.04] p-1.5 transition-colors hover:bg-lime-400/15 active:scale-90"
              >
                <StickerImage name={name} alt={name} variant="fill" />
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
