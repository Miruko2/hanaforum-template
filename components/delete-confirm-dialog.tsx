"use client"

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { Trash2, Loader2 } from "lucide-react"

interface DeleteConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  /** 删除进行中：确认按钮禁用并显示「删除中...」 */
  loading?: boolean
  /** 可选：被删对象的预览标题（如帖子标题），展示在正文上方 */
  title?: string
}

/**
 * 删除确认弹窗：磨砂毛玻璃 + 警示色，复刻站点 announcement-modal 的视觉语言。
 *
 * 与通知/公告弹窗保持同款：深色玻璃面板、白底反光描边、framer-motion spring 入场、
 * 圆形图标抬头。这里把图标换成 Trash2 + 红/橙警示色，传达「危险操作」的语气。
 *
 * ⚠️ 毛玻璃铁律（此处曾翻车「一直透明、没磨砂」）：backdrop-filter 一旦有任一【祖先】
 * 元素建立了 "backdrop root"，子孙就只能采样到那个祖先、采不到页面背景 → 模糊彻底失效。
 * 建立 backdrop root 的属性：opacity<1、filter(哪怕 blur0)、will-change 含上述属性、
 * mask/clip-path、mix-blend-mode、isolation、preserve-3d；注意 transform(scale/translate)
 * 不会建立。所以这里：
 *   1) 最外层全屏 wrapper 只做布局，绝不挂 opacity 动画 / willChange:"opacity"——否则它会
 *      成为 backdrop root，把内部遮罩与卡片的毛玻璃全部废掉（常驻 willChange 更是永久透明）。
 *   2) 入场 opacity 淡入直接挂在【毛玻璃本体那一个元素上】（遮罩、卡片各自淡入）；同一元素上
 *      backdrop-filter 与 opacity/transform 合法共存。
 * 毛玻璃【从首帧就在】：backdrop-filter 一直开着，入场只淡入 opacity + 轻微 spring，于是是
 * 「磨砂玻璃整体淡入」而非「先透明、约 1 秒后突然上玻璃」。早期版本用 glassReady 定时器延迟
 * 开 blur（仿 announcement-modal），但定时器在弹窗打开瞬间主线程繁忙时会被推迟很久才触发，
 * 用户先看到一层无模糊的透明面板，故已移除。背景详见 app/globals.css 的 .glass-card 注释。
 */
export default function DeleteConfirmDialog({
  open,
  onClose,
  onConfirm,
  loading = false,
  title,
}: DeleteConfirmDialogProps) {
  // 打开时锁滚
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => {
      document.body.style.overflow = ""
    }
  }, [open])

  // ESC 关闭（删除中时不允许）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, loading, onClose])

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {open && (
        /* 最外层 wrapper 只做布局：不挂 opacity 动画、不挂 willChange:"opacity"，否则它会成为
           backdrop root，废掉内部遮罩/卡片的 backdrop-filter（见顶部注释）。入场/退场的淡入淡出
           分别下放到下面的遮罩层和卡片自己身上。 */
        <motion.div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          {/* 背景遮罩：毛玻璃常开，入场只淡入 opacity（与本元素 backdrop-filter 合法共存），
              透出底层帖子墙的磨砂。 */}
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              background: "rgba(8, 8, 14, 0.28)",
              backdropFilter: "blur(14px) saturate(150%)",
              WebkitBackdropFilter: "blur(14px) saturate(150%)",
            }}
            onClick={() => {
              if (!loading) onClose()
            }}
          />

          {/* 删除确认卡片 */}
          <motion.div
            className="relative w-full max-w-md overflow-hidden flex flex-col rounded-2xl border border-white/20 shadow-2xl"
            style={{
              background: "rgba(20, 16, 22, 0.38)",
              backdropFilter: "blur(24px) saturate(180%)",
              WebkitBackdropFilter: "blur(24px) saturate(180%)",
              willChange: "transform, opacity",
              transform: "translateZ(0)",
              boxShadow:
                "0 24px 60px rgba(0,0,0,0.45), 0 0 30px rgba(244,63,94,0.12), inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
            initial={{ scale: 0.96, y: 8, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, y: 4, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 30, mass: 0.8 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 玻璃上沿高光线（与站点其它毛玻璃面板同款反光） */}
            <span
              aria-hidden
              className="absolute top-0 left-[12%] right-[12%] h-px pointer-events-none"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
              }}
            />

            {/* 头部：警示图标 + 标题 */}
            <div className="flex flex-col items-center text-center px-6 pt-7 pb-3">
              <div
                className="h-14 w-14 rounded-full flex items-center justify-center mb-4"
                style={{
                  background: "linear-gradient(135deg, rgba(244,63,94,0.22), rgba(249,115,22,0.16))",
                  border: "1px solid rgba(244,63,94,0.35)",
                  boxShadow: "0 0 22px rgba(244,63,94,0.25), inset 0 1px 0 rgba(255,255,255,0.14)",
                }}
              >
                <Trash2 className="h-6 w-6 text-rose-400" strokeWidth={2.2} />
              </div>
              <p className="text-xs font-medium text-rose-300/90 mb-1">危险操作 · 不可撤销</p>
              <h3 className="text-lg font-bold text-white">确认删除</h3>
            </div>

            {/* 正文 */}
            <div className="px-6 pb-5">
              {title ? (
                <p className="text-sm text-white/70 leading-relaxed text-center">
                  你确定要删除这个帖子吗？
                  <br />
                  <span className="text-white/85 font-medium line-clamp-2 break-words">
                    「{title}」
                  </span>
                  <br />
                  这个操作不可撤销，所有评论也将被删除。
                </p>
              ) : (
                <p className="text-sm text-white/75 leading-relaxed text-center">
                  你确定要删除这个帖子吗？这个操作不可撤销，所有评论也将被删除。
                </p>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-3 px-6 pb-6">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="flex-1 h-11 rounded-xl text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.14)",
                  color: "rgba(255,255,255,0.85)",
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={loading}
                className="flex-1 h-11 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 transition disabled:opacity-60 disabled:cursor-not-allowed"
                style={{
                  background: loading
                    ? "rgba(244,63,94,0.55)"
                    : "linear-gradient(135deg, #f43f5e, #e11d48)",
                  border: "1px solid rgba(255,255,255,0.18)",
                  color: "#fff",
                  boxShadow: "0 8px 22px -6px rgba(244,63,94,0.55), inset 0 1px 0 rgba(255,255,255,0.18)",
                }}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    删除中...
                  </>
                ) : (
                  "确认删除"
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
