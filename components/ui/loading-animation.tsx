"use client"

import { motion, type Variants } from "framer-motion"

interface LoadingAnimationProps {
  size?: "sm" | "md" | "lg" | "xl"
  color?: string
  text?: string
  showText?: boolean
}

/**
 * 优雅的加载动画组件，使用framer-motion实现
 * 可替代原来的旋转圈圈动画
 */
export function LoadingAnimation({
  size = "md",
  color = "text-lime-500",
  text = "加载中",
  showText = false,
}: LoadingAnimationProps) {
  // 根据size属性确定圆点大小
  const dotSize = {
    sm: "w-1.5 h-1.5",
    md: "w-2 h-2",
    lg: "w-2.5 h-2.5",
    xl: "w-3 h-3",
  }[size]

  // 根据size属性确定容器大小
  const containerSize = {
    sm: "h-6",
    md: "h-8",
    lg: "h-12",
    xl: "h-16",
  }[size]

  // 根据size属性确定间距
  const gap = {
    sm: "gap-1.5",
    md: "gap-2",
    lg: "gap-3",
    xl: "gap-4",
  }[size]

  // 根据size确定文字大小
  const fontSize = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
    xl: "text-lg",
  }[size]

  // 动画变体
  const dotVariants: Variants = {
    initial: { y: 0 },
    animate: (i: number) => ({
      y: [0, -10, 0],
      transition: {
        repeat: Infinity,
        repeatType: "loop" as const,
        duration: 1,
        ease: "easeInOut",
        delay: i * 0.15,
      },
    }),
  }

  return (
    <div className={`flex flex-col items-center justify-center ${containerSize}`}>
      <div className={`flex ${gap} items-center justify-center`}>
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className={`${dotSize} rounded-full ${color}`}
            variants={dotVariants}
            initial="initial"
            animate="animate"
            custom={i}
          />
        ))}
      </div>
      {showText && <p className={`mt-2 ${fontSize} ${color}`}>{text}</p>}
    </div>
  )
}

/**
 * 脉冲光环加载动画
 */
export function PulseLoading({
  size = "md",
  color = "text-lime-500",
  text = "加载中",
  showText = false,
}: LoadingAnimationProps) {
  // 根据size属性确定容器大小
  const containerSize = {
    sm: "h-8 w-8",
    md: "h-12 w-12",
    lg: "h-16 w-16",
    xl: "h-20 w-20",
  }[size]

  // 根据size属性确定内部圆的大小
  const innerSize = {
    sm: "h-4 w-4",
    md: "h-6 w-6",
    lg: "h-8 w-8",
    xl: "h-10 w-10",
  }[size]

  // 根据size确定文字大小
  const fontSize = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
    xl: "text-lg",
  }[size]

  // 颜色类
  const colorClass = color.startsWith("text-") ? color.replace("text-", "bg-") : color

  return (
    <div className="flex flex-col items-center justify-center">
      <div className={`relative ${containerSize} flex items-center justify-center`}>
        <motion.div
          className={`absolute ${containerSize} ${colorClass}/20 rounded-full`}
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ 
            scale: [0.5, 1.2, 0.5], 
            opacity: [0.2, 0.6, 0.2]
          }}
          transition={{
            repeat: Infinity,
            duration: 2,
            ease: "easeInOut"
          }}
        />
        <motion.div
          className={`${innerSize} ${colorClass} rounded-full`}
          animate={{ 
            scale: [0.8, 1, 0.8],
            opacity: [0.8, 1, 0.8] 
          }}
          transition={{
            repeat: Infinity,
            duration: 1.5,
            ease: "easeInOut"
          }}
        />
      </div>
      {showText && <p className={`mt-3 ${fontSize} ${color}`}>{text}</p>}
    </div>
  )
}

/**
 * 漂浮卡片加载动画
 */
export function FloatingCardsLoading({
  size = "md",
  color = "text-lime-500",
  text = "加载中",
  showText = false,
}: LoadingAnimationProps) {
  // 根据size属性确定卡片大小
  const cardSize = {
    sm: "w-4 h-5",
    md: "w-5 h-6",
    lg: "w-6 h-8",
    xl: "w-8 h-10",
  }[size]

  // 根据size属性确定容器大小
  const containerSize = {
    sm: "h-12 w-12",
    md: "h-16 w-16",
    lg: "h-20 w-20",
    xl: "h-24 w-24",
  }[size]

  // 根据size确定文字大小
  const fontSize = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
    xl: "text-lg",
  }[size]

  // 颜色类
  const colorClass = color.startsWith("text-") ? color.replace("text-", "bg-") : color

  // 卡片动画变体
  const cardVariants: Variants = {
    initial: (i: number) => ({
      opacity: 0.3,
      y: 0,
      rotate: i * 15,
      x: i * 3,
    }),
    animate: (i: number) => ({
      opacity: i === 0 ? [0.3, 1, 0.3] : [0.3, 0.7, 0.3],
      y: [0, -10, 0],
      rotate: [i * 15, i * 15 + 5, i * 15],
      x: [i * 3, i * 3 + 2, i * 3],
      transition: {
        repeat: Infinity,
        duration: 2,
        ease: "easeInOut",
        delay: i * 0.2,
      },
    }),
  }

  return (
    <div className="flex flex-col items-center justify-center">
      <div className={`relative ${containerSize} flex items-center justify-center`}>
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className={`absolute ${cardSize} ${colorClass} rounded-md shadow-lg`}
            style={{ 
              zIndex: 3 - i,
              filter: `brightness(${100 - i * 15}%)`
            }}
            variants={cardVariants}
            initial="initial"
            animate="animate"
            custom={i}
          />
        ))}
      </div>
      {showText && <p className={`mt-3 ${fontSize} ${color}`}>{text}</p>}
    </div>
  )
} 