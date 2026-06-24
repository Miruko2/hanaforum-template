"use client"

import { useEffect, useState } from "react"
import { Bookmark } from "lucide-react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

interface CollectButtonProps {
  collected: boolean
  isLoading?: boolean
  onClick: (e: React.MouseEvent) => void
  className?: string
  size?: "sm" | "md" | "lg"
}

// 收藏（书签）开关按钮。
// 与点赞不同：收藏是私密的，数不到别人的收藏，所以这里是纯开关、不带数字。
// 配色刻意中性（无绿光/无彩色），与信息流按钮统一；只用「填充 + 轻微弹一下」表达已收藏。
export default function CollectButton({
  collected,
  isLoading = false,
  onClick,
  className = "",
  size = "md",
}: CollectButtonProps) {
  const [pop, setPop] = useState(false)
  const [prev, setPrev] = useState(collected)

  // 从未收藏 → 已收藏时，给图标一个短暂的弹跳
  useEffect(() => {
    if (collected !== prev) {
      if (collected) {
        setPop(true)
        const t = setTimeout(() => setPop(false), 320)
        setPrev(collected)
        return () => clearTimeout(t)
      }
      setPrev(collected)
    }
  }, [collected, prev])

  const iconSize = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  }

  const buttonSize = {
    sm: "px-2 py-1.5",
    md: "px-3 py-2",
    lg: "px-4 py-2.5",
  }

  return (
    <button
      type="button"
      className={cn(
        "relative flex items-center justify-center rounded-full transition-colors duration-300",
        collected ? "text-white bg-white/20" : "text-white/80 hover:bg-white/10 hover:text-white",
        isLoading && "opacity-70 cursor-not-allowed",
        buttonSize[size],
        className
      )}
      onClick={onClick}
      disabled={isLoading}
      aria-label={collected ? "取消收藏" : "收藏"}
      aria-pressed={collected}
    >
      <motion.span
        className="relative flex"
        animate={pop ? { scale: [1, 1.32, 1] } : { scale: 1 }}
        transition={{ duration: 0.32, ease: "easeOut" }}
      >
        <Bookmark className={cn(iconSize[size], collected && "fill-current")} />
      </motion.span>
    </button>
  )
}
