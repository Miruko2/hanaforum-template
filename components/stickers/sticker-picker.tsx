"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
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

// 面板与按钮之间的间隙、以及距视口边缘的最小留白
const GAP = 8
const MARGIN = 8
// 面板固定宽度（与下方 w-[240px] 保持一致），用于水平方向防越界
const PANEL_W = 240

type Coords = { left?: number; right?: number; bottom: number; maxHeight: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/**
 * 表情包选择器：一个笑脸按钮 + 弹出的表情网格，点选回调 onSelect(name)。
 * 复用聊天窗同款表情资源，外观走站点深色 + lime 玻璃风。
 * 面板向上弹出，适配「输入栏在底部」的发帖/评论场景。
 *
 * ⚠️ 面板用 portal 渲染到 document.body、固定定位贴在按钮上方：评论卡、评论框的
 * 折叠动画容器、楼中楼回复区等多层祖先都带 overflow-hidden，若面板留在原 DOM 位置
 * 会被这些裁剪容器整块裁掉 ——「点表情没反应」的根因。脱离原 DOM 后不再受任何
 * overflow/裁剪上下文影响。坐标随滚动/缩放实时跟随按钮。
 */
export function StickerPicker({ onSelect, disabled, className, align = "left" }: StickerPickerProps) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<Coords | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 依据触发按钮在视口中的位置，算出固定定位面板的坐标（面板向上生长）。
  const reposition = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const hi = Math.max(MARGIN, window.innerWidth - PANEL_W - MARGIN)
    const next: Coords = {
      // 面板底边贴在按钮上方 GAP 处，向上自然生长，无需测量面板高度
      bottom: window.innerHeight - r.top + GAP,
      // 高度上限 = 按钮上方的可用空间，超出则面板内部滚动，绝不溢出视口顶部
      maxHeight: Math.max(120, r.top - GAP - MARGIN),
    }
    if (align === "right") next.right = clamp(window.innerWidth - r.right, MARGIN, hi)
    else next.left = clamp(r.left, MARGIN, hi)
    setCoords(next)
  }, [align])

  // 打开时跟随滚动/缩放重新定位（捕获阶段以监听内层滚动容器的滚动）
  useEffect(() => {
    if (!open) return
    const onMove = () => reposition()
    window.addEventListener("scroll", onMove, true)
    window.addEventListener("resize", onMove)
    return () => {
      window.removeEventListener("scroll", onMove, true)
      window.removeEventListener("resize", onMove)
    }
  }, [open, reposition])

  // 点击/触摸按钮与面板之外时收起
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    document.addEventListener("touchstart", handler)
    return () => {
      document.removeEventListener("mousedown", handler)
      document.removeEventListener("touchstart", handler)
    }
  }, [open])

  const toggle = () => {
    if (disabled) return
    if (open) {
      setOpen(false)
    } else {
      // 先按当前位置算坐标、再开 —— 与 setOpen 同批渲染，开场即定位、无闪跳
      reposition()
      setOpen(true)
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={toggle}
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

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <motion.div
                ref={panelRef}
                initial={{ opacity: 0, scale: 0.85, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.85, y: 8 }}
                transition={{ type: "spring", stiffness: 400, damping: 25, mass: 0.8 }}
                style={{
                  position: "fixed",
                  bottom: coords.bottom,
                  left: coords.left,
                  right: coords.right,
                  maxHeight: coords.maxHeight,
                  transformOrigin: align === "right" ? "bottom right" : "bottom left",
                  zIndex: 9999,
                }}
                // 真·毛玻璃：低透明度浅色底（让 backdrop-filter 有东西可糊）+ 强模糊/饱和 +
                // lime 描边 + 顶部内高光 + 柔和绿光晕。面板 portal 到 body、无破坏 backdrop-filter
                // 的祖先（filter/opacity<1），磨砂在此可正常生效。
                className="flex w-[240px] flex-col rounded-2xl border border-lime-300/25 bg-white/[0.12] p-2.5 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.5),0_0_26px_rgba(163,230,53,0.12),inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-2xl backdrop-saturate-150"
              >
                {/* 标题条：荧光绿小标 + 绝区零 45° 斜条纹角标，给面板一个品牌化的「框」 */}
                <div className="mb-2 flex items-center gap-1.5 px-0.5">
                  <Smile className="h-3.5 w-3.5 text-lime-300" />
                  <span className="text-[11px] font-medium tracking-wide text-lime-300/90">表情</span>
                  <span
                    aria-hidden
                    className="ml-auto h-2 w-9 rounded-[2px] opacity-70"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(45deg, rgba(163,230,53,0.55) 0 3px, transparent 3px 6px)",
                    }}
                  />
                </div>

                {/* 表情网格：超量时此区内部滚动，标题条保持常驻 */}
                <div className="grid min-h-0 grid-cols-3 gap-2 overflow-y-auto px-0.5 pt-0.5">
                  {STICKERS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        onSelect(name)
                        setOpen(false)
                      }}
                      aria-label={name}
                      // hover：上浮 + lime 描边 + 绿光晕（绝区零霓虹），active 回弹
                      className="flex aspect-square items-center justify-center rounded-xl bg-white/[0.06] p-1.5 ring-1 ring-inset ring-white/10 transition-all duration-200 hover:-translate-y-0.5 hover:bg-lime-400/15 hover:ring-lime-400/50 hover:shadow-[0_0_18px_rgba(163,230,53,0.25)] active:scale-90"
                    >
                      <StickerImage name={name} alt={name} variant="fill" className="rounded-lg" />
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  )
}
