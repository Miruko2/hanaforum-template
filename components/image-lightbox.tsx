"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { X, Loader2 } from "lucide-react"

interface ImageLightboxProps {
  /** 图片直链；为 null/空时不展示灯箱 */
  src: string | null
  alt?: string
  onClose: () => void
}

/**
 * 图片灯箱：点击帖子详情页的图片后，原图在屏幕中心聚焦放大。
 *
 * 交互时序（关键）：点击 → 遮罩立即淡入 + 居中 loading（不再阻塞等原图下载完才出现）；
 * 原图在后台加载，加载完成后图片才做「轻弹跳」入场。这样：
 *   1. 点击即时有反馈（遮罩 + spinner），不再「干等一会儿才弹出」；
 *   2. 弹跳发生在图片已解码之后，避免「一边解码大图一边做 spring」导致的掉帧。
 *
 * portal 到 body：避开详情模态框的 overflow-hidden 裁切与 z-index 层叠陷阱，
 * 始终盖在最上层。用原生 <img> 直接加载原图，拿到原始分辨率，也免去 next/image 白名单。
 */
export default function ImageLightbox({ src, alt = "", onClose }: ImageLightboxProps) {
  // 原图是否加载完成 —— 决定何时触发弹入动画
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    if (!src) return
    setLoaded(false)
    // 缓存命中时，<img> 可能在 React 绑定 onLoad 之前就已 complete，onLoad 不会再触发；
    // 下一帧用 complete 兜底，确保已缓存的图也能正常弹入（否则会一直停在 loading）。
    const raf = requestAnimationFrame(() => {
      const el = imgRef.current
      if (el && el.complete && el.naturalWidth > 0) setLoaded(true)
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("keydown", onKey)
    }
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

          {/* 加载中：图片还没就绪时居中显示 spinner，避免点开后一片空白的「等待感」 */}
          {!loaded && (
            <Loader2 className="pointer-events-none absolute h-8 w-8 animate-spin text-white/70" />
          )}

          {/* 居中放大的原图：加载完成后才做轻弹跳入场（此时图已解码，spring 流畅）。
              幅度从 0.35→1 收敛到 0.6→1、阻尼调大，减小移动端的合成压力与过冲抖动。 */}
          <motion.img
            ref={imgRef}
            src={src}
            alt={alt}
            draggable={false}
            decoding="async"
            onClick={(e) => e.stopPropagation()}
            onLoad={() => setLoaded(true)}
            className="max-h-full max-w-full select-none rounded-2xl object-contain shadow-[0_30px_90px_-20px_rgba(0,0,0,0.8)] cursor-zoom-out"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={loaded ? { scale: 1, opacity: 1 } : { scale: 0.6, opacity: 0 }}
            exit={{ scale: 0.5, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 24, mass: 0.7 }}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
