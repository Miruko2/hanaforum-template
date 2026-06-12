"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import { isAndroidRuntime } from "@/lib/view-transition-nav"
import { cn } from "@/lib/utils"
import type { CreatePostForm } from "@/components/create-post-modal"

type FormComponent = typeof CreatePostForm

interface FloatingActionButtonProps {
  onPostCreated?: () => void
}

// 果冻感来自低阻尼弹簧的过冲回弹；收回时调高阻尼，干脆利落
const OPEN_SPRING = { type: "spring", stiffness: 290, damping: 21, mass: 1 } as const
const CLOSE_SPRING = { type: "spring", stiffness: 380, damping: 28, mass: 0.9 } as const

/**
 * 发帖按钮与发帖面板是同一个常驻元素：点击后按钮经 framer-motion 的
 * layout FLIP（纯 transform，安卓 WebView 安全）果冻形变成居中面板，
 * 关闭时反向缩回按钮位。lime 按钮皮是一层 opacity 交叉淡出的内层。
 */
export default function FloatingActionButton({ onPostCreated }: FloatingActionButtonProps) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [FormComp, setFormComp] = useState<FormComponent | null>(null)
  const openRef = useRef(false)
  const lockedRef = useRef(false)
  const prevOverflowRef = useRef("")
  const { user } = useSimpleAuth()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    setMounted(true)
  }, [])

  // 空闲时预载表单代码：打开时面板与表单必须同帧挂载，FLIP 才能量到正确的目标尺寸
  useEffect(() => {
    const t = window.setTimeout(() => {
      import("@/components/create-post-modal")
        .then((m) => setFormComp(() => m.CreatePostForm))
        .catch(() => {})
    }, 1200)
    return () => window.clearTimeout(t)
  }, [])

  const unlockScroll = useCallback(() => {
    if (!lockedRef.current) return
    lockedRef.current = false
    document.body.style.overflow = prevOverflowRef.current
    document.body.style.touchAction = ""
  }, [])

  const lockScroll = useCallback(() => {
    if (lockedRef.current) return
    lockedRef.current = true
    prevOverflowRef.current = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.body.style.touchAction = "none"
  }, [])

  // 滚动解锁推迟到回缩动画完成（onLayoutAnimationComplete），立即解锁会触发
  // 整页 reflow 吃掉退出动画；这里只做定时兜底，防动画被打断时收不到完成回调
  const close = useCallback(() => {
    openRef.current = false
    setOpen(false)
    window.setTimeout(() => {
      if (!openRef.current) unlockScroll()
    }, 900)
  }, [unlockScroll])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, close])

  // 卸载（如路由跳转）时若仍锁着滚动，恢复之
  useEffect(() => unlockScroll, [unlockScroll])

  const handleButtonClick = async () => {
    if (!user) {
      toast({
        title: "请先登录",
        description: "发布帖子前请先登录账号",
      })
      router.push("/login")
      return
    }

    if (!FormComp) {
      try {
        const m = await import("@/components/create-post-modal")
        setFormComp(() => m.CreatePostForm)
      } catch {
        toast({
          title: "加载失败",
          description: "发帖组件加载失败，请检查网络后重试",
          variant: "destructive",
        })
        return
      }
    }
    lockScroll()
    openRef.current = true
    setOpen(true)
  }

  const handlePostCreated = () => {
    close()
    if (onPostCreated) {
      onPostCreated()
    } else {
      toast({
        title: "发布成功",
        description: "帖子已发布，正在刷新列表...",
        duration: 3000,
      })
    }
  }

  if (!mounted) return null

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="composer-overlay"
            className={cn(
              "fixed inset-0 z-40",
              isAndroidRuntime ? "bg-black/70" : "bg-black/60 backdrop-blur-md",
            )}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            onClick={close}
          />
        )}
      </AnimatePresence>

      {/* 常驻定位层：合上时托住右下角按钮，展开时 flex 居中面板 */}
      <div
        className={cn(
          "pointer-events-none fixed inset-0 flex items-center justify-center",
          open ? "z-50" : "z-[999]",
        )}
      >
        <AnimatePresence>
          {!open && (
            <motion.span
              key="fab-ping"
              className="absolute bottom-6 right-6 h-14 w-14 rounded-full bg-lime-400/20 animate-ping"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.45, duration: 0.2 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            />
          )}
        </AnimatePresence>

        <motion.div
          layout
          role={open ? "dialog" : "button"}
          aria-modal={open || undefined}
          aria-label={open ? "创建新帖子" : "发布新帖子"}
          tabIndex={open ? -1 : 0}
          onClick={open ? undefined : handleButtonClick}
          onKeyDown={
            open
              ? undefined
              : (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    handleButtonClick()
                  }
                }
          }
          onLayoutAnimationComplete={() => {
            if (!openRef.current) unlockScroll()
          }}
          className={cn(
            "group pointer-events-auto overflow-hidden border",
            open
              ? "relative border-white/15"
              : "absolute bottom-6 right-6 cursor-pointer border-lime-300/40",
          )}
          style={{
            // borderRadius 放 style 里让 framer 做缩放畸变校正
            borderRadius: open ? 24 : 28,
            width: open ? "min(42rem, calc(100vw - 32px))" : 56,
            height: open ? "auto" : 56,
            // 安卓 WebView：实底背景、禁 backdrop-filter（形变中带毛玻璃会鬼影/卡顿）
            background: isAndroidRuntime ? "rgba(21, 23, 27, 0.97)" : "rgba(255, 255, 255, 0.07)",
            ...(isAndroidRuntime
              ? {}
              : {
                  backdropFilter: "blur(24px) saturate(150%)",
                  WebkitBackdropFilter: "blur(24px) saturate(150%)",
                }),
          }}
          animate={{
            boxShadow: open
              ? "0 18px 50px rgba(0, 0, 0, 0.5)"
              : "0 6px 22px rgba(132, 204, 22, 0.45)",
          }}
          transition={{
            layout: open ? OPEN_SPRING : CLOSE_SPRING,
            boxShadow: { duration: 0.32 },
          }}
        >
          {/* 果冻皮：合上时是 lime 按钮皮，展开时淡出露出面板底 */}
          <motion.div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-lime-400 to-lime-500"
            initial={false}
            animate={{ opacity: open ? 0 : 1 }}
            transition={{ duration: open ? 0.26 : 0.2, delay: open ? 0.04 : 0.16 }}
          >
            <span className="absolute inset-0 bg-white/20 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
          </motion.div>

          <AnimatePresence>
            {open && FormComp && (
              <motion.div
                key="composer-form"
                className="relative max-h-[85vh] overflow-y-auto overscroll-contain"
                initial={{ opacity: 0, y: 14 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  transition: { delay: 0.13, duration: 0.24, ease: "easeOut" },
                }}
                exit={{ opacity: 0, transition: { duration: 0.09 } }}
              >
                <FormComp onClose={close} onPostCreated={handlePostCreated} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Plus 图标钉在按钮位（不随果冻体拉伸），形变启程/归位时旋转淡出入 */}
        <AnimatePresence>
          {!open && (
            <motion.span
              key="fab-icon"
              className="pointer-events-none absolute bottom-6 right-6 flex h-14 w-14 items-center justify-center text-black"
              initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
              animate={{
                opacity: 1,
                rotate: 0,
                scale: 1,
                transition: { delay: 0.25, duration: 0.18 },
              }}
              exit={{ opacity: 0, rotate: 90, scale: 0.5, transition: { duration: 0.12 } }}
            >
              <Plus className="h-6 w-6" />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </>,
    document.body,
  )
}
