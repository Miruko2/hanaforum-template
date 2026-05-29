"use client"

import { useEffect, useRef, useState, useLayoutEffect } from "react"
import { useRouter } from "next/navigation"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { CATEGORIES } from "@/lib/categories"

interface CategoryMenuProps {
  activeCategory: string | null
  /** 当前是否 mobile（控制菜单宽度） */
  compact?: boolean
}

/**
 * 分类下拉菜单。点击按钮弹出毛玻璃面板，列表项点击后更新 URL 并派发 category-changed 事件。
 */
export default function CategoryMenu({ activeCategory, compact = false }: CategoryMenuProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  // 触发按钮的视口位置，用于 portal 定位
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // 打开时测量按钮位置，窗口变化时也重测
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const measure = () => {
      if (buttonRef.current) {
        setAnchorRect(buttonRef.current.getBoundingClientRect())
      }
    }
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [open])

  // 点击外部关闭：同时检查按钮和 portal 面板
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        !containerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", handler)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  /** 切换分类：更新 URL query，并派发事件让首页感知 */
  const selectCategory = (value: string | null) => {
    const url = new URL(window.location.href)
    if (value) {
      url.searchParams.set("category", value)
    } else {
      url.searchParams.delete("category")
    }
    // 保留在首页；如果当前不在首页，router.push 也能跨路由
    const targetUrl = `/${url.search}${url.hash}`
    router.push(targetUrl)
    setOpen(false)
  }

  const activeDef = CATEGORIES.find(c => c.value === activeCategory)

  // 下拉面板内容（复用到 portal 里）
  const panel = anchorRect ? (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: -8, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.96, transition: { duration: 0.15 } }}
          transition={{ type: "spring", stiffness: 520, damping: 28, mass: 0.7 }}
          className={cn(
            "fixed z-[60] p-2 rounded-2xl border border-white/15 shadow-2xl",
            compact ? "w-56" : "w-64",
          )}
          style={{
            top: anchorRect.bottom + 12,
            left: anchorRect.left,
            transformOrigin: "top left",
            background: "rgba(20, 20, 28, 0.55)",
            backdropFilter: "blur(24px) saturate(150%)",
            WebkitBackdropFilter: "blur(24px) saturate(150%)",
          }}
        >
          {/* 顶部小标题 + 清除过滤 */}
          <div className="flex items-center justify-between px-2.5 pt-1 pb-2 text-[10px] tracking-[0.3em] uppercase text-white/40">
            <span>CATEGORIES</span>
            {activeCategory && (
              <button
                onClick={() => selectCategory(null)}
                className="flex items-center gap-1 text-[10px] text-white/50 hover:text-lime-400 transition-colors"
              >
                <X className="h-3 w-3" />
                清除
              </button>
            )}
          </div>

          {/* 全部 */}
          <MenuItem
            label="全部"
            glyph="✱"
            active={!activeCategory}
            onClick={() => selectCategory(null)}
            delay={0}
          />

          {/* 分类列表 */}
          {CATEGORIES.map((cat, i) => (
            <MenuItem
              key={cat.value}
              label={cat.label}
              glyph={cat.glyph}
              active={activeCategory === cat.value}
              onClick={() => selectCategory(cat.value)}
              delay={(i + 1) * 0.03}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  ) : null

  return (
    <div ref={containerRef} className="relative">
      {/* 触发按钮 */}
      <button
        ref={buttonRef}
        onClick={() => setOpen(v => !v)}
        className={cn(
          "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200",
          open
            ? "bg-lime-400/20 text-lime-400 shadow-lg"
            : activeDef
              ? "bg-lime-400/15 text-lime-400"
              : "text-gray-300 hover:text-lime-400 hover:bg-white/10",
        )}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span>{activeDef ? activeDef.label : "分类"}</span>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180")}
        />
      </button>

      {/* 面板通过 portal 渲染到 body，避免被导航栏的 backdrop-filter 祖先容器限制采样范围 */}
      {mounted && panel && createPortal(panel, document.body)}
    </div>
  )
}

function MenuItem({
  label,
  glyph,
  active,
  onClick,
  delay,
}: {
  label: string
  glyph: string
  active: boolean
  onClick: () => void
  delay: number
}) {
  return (
    <motion.button
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay, ease: "easeOut" }}
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors",
        active
          ? "bg-lime-400/15 text-lime-400"
          : "text-white/80 hover:bg-white/[0.07] hover:text-white",
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center w-6 h-6 text-xs rounded-md",
          active ? "bg-lime-400/20 text-lime-400" : "bg-white/[0.06] text-white/50",
        )}
      >
        {glyph}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {active && <span className="h-1.5 w-1.5 rounded-full bg-lime-400" />}
    </motion.button>
  )
}
