"use client"

import { useState, useEffect } from "react"
import { ThumbsUp } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"

interface LikeButtonProps {
  liked: boolean
  count: number
  isLoading?: boolean
  onClick: (e: React.MouseEvent) => void
  className?: string
  size?: "sm" | "md" | "lg"
}

export default function LikeButton({
  liked,
  count,
  isLoading = false,
  onClick,
  className = "",
  size = "md",
}: LikeButtonProps) {
  const [isAnimating, setIsAnimating] = useState(false)
  const [prevLiked, setPrevLiked] = useState(liked)

  // 监测点赞状态变化触发动画
  useEffect(() => {
    if (liked !== prevLiked) {
      setIsAnimating(true)
      const timer = setTimeout(() => {
        setIsAnimating(false)
      }, 700)
      setPrevLiked(liked)
      return () => clearTimeout(timer)
    }
  }, [liked, prevLiked])

  // 根据尺寸确定图标大小
  const iconSize = {
    sm: "h-4 w-4",
    md: "h-5 w-5",
    lg: "h-6 w-6",
  }

  // 按钮大小
  const buttonSize = {
    sm: "px-2 py-1.5 text-xs",
    md: "px-3 py-2 text-sm",
    lg: "px-4 py-2.5 text-base",
  }

  return (
    <button
      className={cn(
        "relative flex items-center space-x-1.5 transition-colors duration-300 rounded-full",
        liked ? "text-white bg-white/20" : "text-white/80 hover:bg-white/10 hover:text-white",
        isLoading && "opacity-70 cursor-not-allowed",
        buttonSize[size],
        className
      )}
      onClick={onClick}
      disabled={isLoading}
    >
      <div className="relative">
        {/* 基本图标 */}
        <ThumbsUp className={cn(iconSize[size], liked && "fill-current")} />
        
        {/* 点赞特效 - 波纹 */}
        {isAnimating && liked && (
          <motion.div
            initial={{ scale: 0, opacity: 1 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute inset-0 bg-lime-400 rounded-full z-0"
          />
        )}
        
        {/* 点赞特效 - 小心形 */}
        {isAnimating && liked && (
          <AnimatePresence>
            {[...Array(3)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute text-lime-400 text-xs"
                initial={{ 
                  y: 0, 
                  x: (i - 1) * 10, 
                  opacity: 1,
                  scale: 0.2
                }}
                animate={{ 
                  y: -20, 
                  opacity: 0,
                  scale: 1.2
                }}
                transition={{ 
                  duration: 0.8 + i * 0.1, 
                  ease: "easeOut" 
                }}
                style={{
                  top: "50%",
                  left: "50%",
                }}
              >
                +1
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
      
      {/* 计数动画 - 确保数字可见。flex items-center：h-5 容器比 sm 尺寸的 text-xs
          行高(16px)高 4px，不居中会让数字比图标中心偏高 ~2px */}
      <div className="relative flex h-5 items-center overflow-visible min-w-[16px]">
        <AnimatePresence mode="wait">
          <motion.span
            key={count}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="block"
          >
            {count}
          </motion.span>
        </AnimatePresence>
      </div>
    </button>
  )
} 