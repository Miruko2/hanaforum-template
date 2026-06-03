"use client"

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { X } from "lucide-react"

interface ImageLightboxProps {
  /** 图片直链；为 null/空时不展示灯箱 */
  src: string | null
  alt?: string
  onClose: () => void
}

/**
 * 图片灯箱：点击帖子详情页的图片后，原图在屏幕中心聚焦放大。
 * 进出都是 spring 弹跳（overshoot 回弹）。点击遮罩 / 图片 / 按 ESC 关闭。
 *
 * portal 到 body：避开详情模态框的 overflow-hidden 裁切与 z-index 层叠陷阱，
 * 始终盖在最上层。用原生 <img> 直接加载原图，拿到的是原始分辨率，
 * 也免去 next/image 的域名白名单配置。
 */
export default function ImageLightbox({ src, alt = "", onClose }: ImageLightboxProps) {
  // ESC 关闭
  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [src, onClose])

  if (typeof window === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {src && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-10"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          style={{
            background: "rgba(0,0,0,0.82)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
          }}
        >
          {/* 关闭按钮 */}
          <motion.button
            type="button"
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            className="absolute top-4 right-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 hover:text-white"
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.15 } }}
            exit={{ opacity: 0 }}
          >
            <X className="h-5 w-5" />
          </motion.button>

          {/* 居中放大的原图：spring 弹跳进出 */}
          <motion.img
            src={src}
            alt={alt}
            draggable={false}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full select-none rounded-2xl object-contain shadow-[0_30px_90px_-20px_rgba(0,0,0,0.8)] cursor-zoom-out"
            initial={{ scale: 0.35, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 20, mass: 0.8 }}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
