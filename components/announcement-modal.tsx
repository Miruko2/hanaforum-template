"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { X, Loader2 } from "lucide-react"
import { formatDate } from "@/lib/utils"
import { cdnUrl } from "@/lib/cdn-url"

interface AnnouncementModalProps {
  isOpen: boolean
  onClose: () => void
  title: string | null
  content: string | null
  /** 公告配图（可选）：管理员发公告时上传的单张压缩图，走 CDN 缓存层展示 */
  imageUrl?: string | null
  createdAt?: string | null
  loading?: boolean
}

/**
 * 系统公告弹窗：磨砂毛玻璃 + logo 抬头。
 * 用户在通知里点击"公告"类型通知时弹出，展示公告全文。
 */
export default function AnnouncementModal({
  isOpen,
  onClose,
  title,
  content,
  imageUrl,
  createdAt,
  loading = false,
}: AnnouncementModalProps) {
  // 打开时锁滚
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [isOpen])

  // 性能优化：动画期间禁用 backdrop-filter，跑完再启用。
  // 两层 backdrop-filter 在 spring 动画里每帧都要重采样模糊，是手机端 WebView
  // 掉帧的主因。改成静止时才开启 blur，动画期间用纯色填充近似的视觉。
  const [glassReady, setGlassReady] = useState(false)
  useEffect(() => {
    if (isOpen) {
      // 等卡片 spring 大致跑完（~220ms）再启用磨砂
      const t = window.setTimeout(() => setGlassReady(true), 220)
      return () => window.clearTimeout(t)
    } else {
      // 退场之前立刻关掉磨砂，让退出动画也顺
      setGlassReady(false)
    }
  }, [isOpen])

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ willChange: "opacity" }}
        >
          {/* 背景遮罩：动画期间不开 backdrop-filter，跑完才上磨砂，避免每帧重采样 */}
          <div
            className="absolute inset-0"
            style={{
              // 静止后用 blur(10px) + 半透明黑；动画期间仅用更深的纯色填充近似
              background: glassReady ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.68)",
              backdropFilter: glassReady ? "blur(10px)" : "none",
              WebkitBackdropFilter: glassReady ? "blur(10px)" : "none",
            }}
            onClick={onClose}
          />

          {/* 公告卡片 */}
          <motion.div
            className="relative w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col rounded-2xl border border-white/15 shadow-2xl"
            style={{
              // 动画时纯色实底（不带 backdrop-filter），动画结束切换到磨砂玻璃
              background: glassReady ? "rgba(20, 20, 28, 0.7)" : "rgba(20, 20, 28, 0.88)",
              backdropFilter: glassReady ? "blur(28px) saturate(150%)" : "none",
              WebkitBackdropFilter: glassReady ? "blur(28px) saturate(150%)" : "none",
              // 强制独立 GPU 合成层，spring 动画走 transform 通道，不引发整页重绘
              willChange: "transform, opacity",
              transform: "translateZ(0)",
            }}
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 4 }}
            // 略柔的 spring：插值帧数少、形变小，手机端更稳
            transition={{ type: "spring", stiffness: 340, damping: 30, mass: 0.8 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部：logo + 标题 */}
            <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-white/10">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-11 w-11 shrink-0 rounded-full overflow-hidden border border-white/15 bg-black/40">
                  {/* 站点 logo 作为系统公告头像 */}
                  <img
                    src="/logo.png"
                    alt="萤火虫之国"
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-lime-400 font-medium">系统公告 · 萤火虫之国</p>
                  <h3 className="text-lg font-bold text-white truncate">
                    {title || "公告"}
                  </h3>
                </div>
              </div>
              <button
                onClick={onClose}
                className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 正文 */}
            <div className="overflow-y-auto flex-1 px-6 py-5">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-white/60">
                  <Loader2 className="h-5 w-5 animate-spin text-lime-400 mr-2" />
                  加载中...
                </div>
              ) : (
                <>
                  {imageUrl && (
                    <img
                      src={cdnUrl(imageUrl) || imageUrl}
                      alt={title || "公告配图"}
                      className="mb-4 w-full max-h-[50vh] rounded-xl border border-white/10 object-contain bg-black/20"
                    />
                  )}
                  <p className="text-sm text-white/85 leading-relaxed whitespace-pre-wrap break-words">
                    {content || "（无内容）"}
                  </p>
                  {createdAt && (
                    <p className="mt-5 text-xs text-white/40">{formatDate(createdAt)}</p>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
