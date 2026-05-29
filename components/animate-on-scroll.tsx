"use client"

import { useRef, ReactNode, useEffect, useState } from "react"
import { motion, useAnimation, useInView, type Variants } from "framer-motion"

interface AnimateOnScrollProps {
  children: ReactNode
  animation?: "fade" | "slide-up" | "slide-right" | "scale" | "bounce"
  delay?: number
  duration?: number
  className?: string
  threshold?: number
  once?: boolean
}

export default function AnimateOnScroll({
  children,
  animation = "fade",
  delay = 0,
  duration = 0.5,
  className = "",
  threshold = 0.2,
  once = true,
}: AnimateOnScrollProps) {
  const controls = useAnimation()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: threshold, once })
  const [hasAnimated, setHasAnimated] = useState(false)

  // Define animation variants
  const variants: Variants = {
    hidden: {
      opacity: 0,
      y: animation === "slide-up" ? 50 : 0,
      x: animation === "slide-right" ? -50 : 0,
      scale: animation === "scale" ? 0.8 : 1,
    },
    visible: {
      opacity: 1,
      y: 0,
      x: 0,
      scale: 1,
      transition: {
        duration,
        delay,
        ease: animation === "bounce" ? "backOut" : "easeOut",
      },
    },
  }

  useEffect(() => {
    // Start animation when in view
    if (inView && !hasAnimated) {
      controls.start("visible")
      if (once) {
        setHasAnimated(true)
      }
    }
    // Reset animation if not once and out of view
    if (!inView && !once && hasAnimated) {
      controls.start("hidden")
      setHasAnimated(false)
    }
  }, [inView, controls, once, hasAnimated])

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={controls}
      variants={variants}
      className={className}
    >
      {children}
    </motion.div>
  )
} 