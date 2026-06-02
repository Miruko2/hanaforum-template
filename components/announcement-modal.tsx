"use client"

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { X, Loader2 } from "lucide-react"
import { formatDate } from "@/lib/utils"

interface AnnouncementModalProps {
  isOpen: boolean
  onClose: () => void
  title: string | null
  content: string | null
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

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* 背景遮罩 */}
          <div
            className="absolute inset-0"
            style={{
              background: "rgba(0, 0, 0, 0.55)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
            onClick={onClose}
          />

          {/* 公告卡片 */}
          <motion.div
            className="relative w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col rounded-2xl border border-white/15 shadow-2xl"
            style={{
              background: "rgba(20, 20, 28, 0.7)",
              backdropFilter: "blur(28px) saturate(150%)",
              WebkitBackdropFilter: "blur(28px) saturate(150%)",
            }}
            initial={{ scale: 0.94, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 6 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
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
