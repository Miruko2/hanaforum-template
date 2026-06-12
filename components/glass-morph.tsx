"use client"

import React, { useState, useEffect, useRef } from "react"
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion"
import { cn } from "@/lib/utils"

interface GlassMorphProps {
  children: React.ReactNode
  className?: string
  intensity?: number
  animate?: boolean
  borderGlow?: boolean
  dark?: boolean
  tiltEffect?: boolean
  imageRatio?: number
  adaptiveHeight?: boolean
  wideTemplate?: boolean
  /** 移动端降模糊：把毛玻璃 blur 半径整体调低，省 GPU 重采样 */
  reduceBlur?: boolean
  /** 安卓等弱合成器环境：完全去掉 backdrop-filter，改近实底深色背景。
   *  适用「面板下方已有全屏模糊遮罩」的场景（如帖子详情弹窗）：毛玻璃采样的
   *  本来就是已模糊画面，实底观感几乎一致；面板做 transform 进出场时从
   *  「每帧重采样背景」变成纯合成，低端安卓不再掉帧。 */
  solid?: boolean
}

export function GlassMorph({
  children,
  className,
  intensity = 20,
  animate = true,
  borderGlow = true,
  dark = false,
  tiltEffect = false,
  imageRatio,
  adaptiveHeight = false,
  wideTemplate = false,
  reduceBlur = false,
  solid = false,
}: GlassMorphProps) {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [isHovered, setIsHovered] = useState(false)
  const [isMounted, setIsMounted] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  
  // Motion values for smooth tilt effect
  const rotateX = useMotionValue(0)
  const rotateY = useMotionValue(0)
  
  // Add springs for smoother animation
  const springRotateX = useSpring(rotateX, { stiffness: 150, damping: 20 })
  const springRotateY = useSpring(rotateY, { stiffness: 150, damping: 20 })
  
  // Convert rotation to a glow direction
  const glowX = useTransform(springRotateY, [-10, 10], ['-20%', '120%'])
  const glowY = useTransform(springRotateX, [-10, 10], ['120%', '-20%'])
  
  // Handle component mount
  useEffect(() => {
    setIsMounted(true)
    return () => setIsMounted(false)
  }, [])
  
  // Update element dimensions on resize
  useEffect(() => {
    if (!isMounted) return
    
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        })
      }
    }
    
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [isMounted])
  
  // Calculate gradient position based on mouse
  const calculateGradientPosition = (x: number, y: number) => {
    if (dimensions.width === 0 || dimensions.height === 0) return { x: 50, y: 50 }
    
    // Convert to percentage
    const xPercent = (x / dimensions.width) * 100
    const yPercent = (y / dimensions.height) * 100
    
    // Calculate rotation if tilt effect is enabled
    if (tiltEffect && containerRef.current) {
      // Convert to values between -10 and 10 degrees
      const centerX = dimensions.width / 2
      const centerY = dimensions.height / 2
      
      const rotX = ((y - centerY) / centerY) * -6
      const rotY = ((x - centerX) / centerX) * 6
      
      rotateX.set(rotX)
      rotateY.set(rotY)
    }
    
    // Clamp values
    return {
      x: Math.max(0, Math.min(100, xPercent)),
      y: Math.max(0, Math.min(100, yPercent))
    }
  }
  
  // Handle mouse movement
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!animate) return
    
    const element = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - element.left
    const y = e.clientY - element.top
    
    setMousePosition({ x, y })
  }
  
  const handleMouseLeave = () => {
    setIsHovered(false)
    if (tiltEffect) {
      rotateX.set(0)
      rotateY.set(0)
    }
  }
  
  const { x, y } = isHovered && animate 
    ? calculateGradientPosition(mousePosition.x, mousePosition.y) 
    : { x: 50, y: 50 }
    
  // Dynamic styles based on props
  const baseOpacity = dark ? 0.15 : 0.08
  const hoverOpacity = dark ? 0.2 : 0.12
  
  // reduceBlur（移动端）：毛玻璃模糊半径整体调低，省 GPU 重采样；视觉仍是毛玻璃、强度略减、肉眼基本无差。
  const baseBlur = dark ? (reduceBlur ? "16px" : "30px") : (reduceBlur ? "12px" : "20px")
  const hoverBlur = dark ? (reduceBlur ? "20px" : "40px") : (reduceBlur ? "16px" : "25px")
  
  const baseBorderOpacity = dark ? 0.15 : 0.08
  const hoverBorderOpacity = dark ? 0.25 : 0.15
  
  // Adjust intensity to make subtle
  const tiltIntensity = intensity * 0.5
  
  // 根据图片比例动态计算样式
  const getAdaptiveStyles = () => {
    if (!adaptiveHeight || !imageRatio) return {};
    
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
    
    // 计算高宽比的逆，得到宽高比
    const widthToHeightRatio = 1 / imageRatio;
    
    // 根据模板类型应用不同的样式
    if (wideTemplate) {
      // 宽模板样式 - 横向图片
      if (isMobile) {
        if (imageRatio < 1.2) {
          // 接近正方形但宽一些的图
          return { minHeight: "160px" };
        } else if (imageRatio < 1.5) {
          // 略宽于正方形
          return { minHeight: "150px" };
        } else if (imageRatio < 1.8) {
          // 标准横图
          return { minHeight: "140px" };
        } else if (imageRatio < 2.2) {
          // 较宽横图
          return { minHeight: "130px" };
        } else {
          // 特别宽的横图
          return { minHeight: "120px" };
        }
      } else {
        // 桌面端的宽模板
        if (imageRatio < 1.2) {
          return { minHeight: "220px" };
        } else if (imageRatio < 1.5) {
          return { minHeight: "200px" };
        } else if (imageRatio < 1.8) {
          return { minHeight: "180px" };
        } else if (imageRatio < 2.2) {
          return { minHeight: "160px" };
        } else {
          return { minHeight: "140px" };
        }
      }
    } else {
      // 高模板样式 - 竖向图片
      if (isMobile) {
        // 移动端使用更小的高度
        if (imageRatio < 0.6) {
          // 特别高的竖图
          return { minHeight: "260px" };
        } else if (imageRatio < 0.8) {
          // 标准竖图
          return { minHeight: "240px" };
        } else if (imageRatio < 1.0) {
          // 略高于正方形
          return { minHeight: "220px" };
        } else {
          // 其他情况
          return { minHeight: "180px" };
        }
      } else {
        // 桌面端标准高度
        if (imageRatio < 0.6) {
          // 特别高的竖图
          return { minHeight: "350px" };
        } else if (imageRatio < 0.8) {
          // 标准竖图
          return { minHeight: "320px" };
        } else if (imageRatio < 1.0) {
          // 略高于正方形
          return { minHeight: "280px" };
        } else {
          // 其他情况
          return { minHeight: "220px" };
        }
      }
    }
  };

  // 计算自适应样式
  const adaptiveStyles = getAdaptiveStyles();
  
  return (
    <motion.div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden",
        className
      )}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      style={{
        border: "1px solid",
        borderRadius: "24px",
        willChange: solid
          ? "transform, opacity"
          : "transform, backdrop-filter, background, border-color, box-shadow",
        transformStyle: "preserve-3d",
        transform: tiltEffect ?
          `perspective(1000px) rotateX(${springRotateX}deg) rotateY(${springRotateY}deg) translateZ(0)` :
          "translateZ(0)",
        ...adaptiveStyles,
      }}
      initial={{
        opacity: 0,
        background: solid
          ? "rgba(25, 25, 35, 0.93)"
          : `rgba(${dark ? '0, 0, 0' : '255, 255, 255'}, ${baseOpacity})`,
        borderColor: `rgba(255, 255, 255, ${baseBorderOpacity})`,
        // solid 模式完全不挂 backdropFilter（连 blur(0) 都不挂 —— filter 属性本身就会建采样层）
        ...(solid ? {} : { backdropFilter: `blur(${baseBlur})` }),
      }}
      animate={{
        opacity: 1,
        background: solid
          ? "rgba(25, 25, 35, 0.93)"
          : isHovered
            ? `rgba(${dark ? '0, 0, 0' : '255, 255, 255'}, ${hoverOpacity})`
            : `rgba(${dark ? '0, 0, 0' : '255, 255, 255'}, ${baseOpacity})`,
        ...(solid ? {} : { backdropFilter: isHovered ? `blur(${hoverBlur})` : `blur(${baseBlur})` }),
        borderColor: isHovered
          ? `rgba(255, 255, 255, ${hoverBorderOpacity})`
          : `rgba(255, 255, 255, ${baseBorderOpacity})`,
        boxShadow: isHovered
          ? `0 10px 30px rgba(0, 0, 0, 0.3), 0 0 20px rgba(255, 255, 255, 0.1)`
          : "0 4px 20px rgba(0, 0, 0, 0.2)"
      }}
      transition={{
        duration: 0.3,
        ease: "easeOut"
      }}
    >
      {/* Animated gradient overlay */}
      {animate && (
        <motion.div
          className="absolute inset-0 pointer-events-none z-0"
          animate={{
            background: isHovered 
              ? `radial-gradient(circle at ${x}% ${y}%, rgba(${dark ? '30, 30, 30' : '255, 255, 255'}, 0.15), transparent 70%)`
              : "none",
            opacity: isHovered ? 1 : 0
          }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          style={{ borderRadius: "inherit" }}
        />
      )}
      
      {/* Animated light shine effect */}
      {animate && (
        <motion.div
          className="absolute inset-0 pointer-events-none z-0 overflow-hidden"
          style={{ borderRadius: "inherit" }}
        >
          <motion.div
            className="absolute w-[200%] h-[200%] pointer-events-none"
            animate={{
              background: isHovered
                ? `linear-gradient(to right, transparent, rgba(255, 255, 255, ${dark ? 0.06 : 0.12}), transparent)` 
                : "none",
              left: isHovered ? ["-200%", "200%"] : "0%",
              top: isHovered ? ["-200%", "200%"] : "0%",
              opacity: isHovered ? 1 : 0
            }}
            transition={{
              left: {
                duration: 1.5,
                ease: "easeInOut",
                repeat: Infinity,
                repeatType: "loop"
              },
              top: {
                duration: 1.5,
                ease: "easeInOut",
                repeat: Infinity,
                repeatType: "loop"
              }
            }}
            style={{
              transform: "rotate(30deg)"
            }}
          />
        </motion.div>
      )}
      
      {/* Border glow effect */}
      {borderGlow && (
        <motion.div
          className="absolute inset-0 pointer-events-none z-0"
          animate={{
            boxShadow: isHovered
              ? `inset 0 0 20px rgba(255, 255, 255, 0.1)`
              : "none",
            opacity: isHovered ? 1 : 0
          }}
          transition={{ duration: 0.4 }}
          style={{ borderRadius: "inherit" }}
        />
      )}
      
      {/* Edge highlight */}
      <motion.div
        className="absolute inset-0 pointer-events-none z-0"
        animate={{
          background: isHovered 
            ? `linear-gradient(135deg, rgba(255, 255, 255, ${dark ? 0.07 : 0.15}) 0%, transparent 100%)`
            : `linear-gradient(135deg, rgba(255, 255, 255, ${dark ? 0.04 : 0.1}) 0%, transparent 100%)`
        }}
        transition={{ duration: 0.3 }}
        style={{ borderRadius: "inherit" }}
      />
      
      {/* Top edge light effect */}
      <motion.div 
        className="absolute top-0 left-[5%] right-[5%] h-[1px] pointer-events-none z-0"
        animate={{
          background: isHovered
            ? "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent)"
            : "linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent)",
          opacity: isHovered ? 1 : 0.6
        }}
        transition={{ duration: 0.3 }}
      />
      
      {/* Content container */}
      <div className="relative z-1" style={{ borderRadius: "inherit" }}>
        {children}
      </div>
    </motion.div>
  )
}

export default GlassMorph 