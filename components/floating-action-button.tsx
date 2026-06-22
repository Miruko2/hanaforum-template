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

type FormModule = typeof import("@/components/create-post-modal")

interface FloatingActionButtonProps {
  onPostCreated?: () => void
}

// 果冻感来自低阻尼弹簧的过冲回弹；收回时调高阻尼，干脆利落
const OPEN_SPRING = { type: "spring", stiffness: 290, damping: 21, mass: 1 } as const
const CLOSE_SPRING = { type: "spring", stiffness: 380, damping: 28, mass: 0.9 } as const

// 按钮中心到视口右/下边缘的距离：24px 边距 + 半径 28
const FAB_CENTER_OFFSET = 52

/**
 * 发帖按钮与发帖面板是同一个常驻元素：点击后按钮经 framer-motion 的
 * layout FLIP 果冻形变成居中面板，关闭时反向缩回按钮位。
 * lime 按钮皮是一层 opacity 交叉淡出的内层。
 *
 * 安卓 WebView 上 layout FLIP 实测闪屏（每帧 borderRadius 校正 + boxShadow
 * 插值都在重绘剧烈变尺寸的图层，纹理重分配跟不上）。安卓改走纯
 * transform/opacity 假形变：面板一次光栅化后整体从按钮位飞行+缩放弹入，
 * 果冻皮交叉淡出，全程合成线程，零每帧重绘。
 *
 * 安卓再优化（消果冻弹入卡顿 + 绿色中途让位）：飞行+缩放阶段表单整树
 * visibility:hidden，只让纯色面板 + lime 果冻皮做弹簧，backdrop-filter 子树零绘制。
 * 两个时机解耦：果冻皮约 240ms（弹窗冲到最大、回弹动态中）就溶解、露出深色面板底
 * （绿色中途让位、不等弹窗站定）；毛玻璃表单约 480ms（scale 贴近 1）才点亮——缩放
 * 途中绘制 backdrop-filter 会逐帧重采样卡顿（最初病根），故必须等到位，其间深色空盒
 * 短暂露出(约 0.08s)再浮现内容。毛玻璃样式不变。
 */
export default function FloatingActionButton({ onPostCreated }: FloatingActionButtonProps) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  // 安卓延帧起跑：面板先以透明态挂载 2 帧完成光栅化，再放弹簧（消起手卡顿）
  const [flying, setFlying] = useState(false)
  // 解耦「果冻皮溶解」与「毛玻璃点亮」两个时机：
  // skinDissolve —— 果冻皮在弹窗还在回弹的中途就溶解，露出深色面板底随弹簧弹到位；
  // formLit —— 毛玻璃表单延后到 scale 贴近 1 才点亮（缩放途中绘制 backdrop-filter 会卡）
  const [skinDissolve, setSkinDissolve] = useState(false)
  const [formLit, setFormLit] = useState(false)
  const [formMod, setFormMod] = useState<FormModule | null>(null)
  // 详情模态（帖子详情/灯箱）打开时隐藏发帖按钮：FAB 是 z-[999] 常驻 fixed 层、盖在
  // 详情(z-40)/灯箱(z-80)之上，详情开/关的重转场 + body 滚动锁切换会把它带得抖动；
  // 且产品设计上看帖时发帖按钮本就该让位。由 PostGrid 在 activePostId 变化时广播。
  const [detailOpen, setDetailOpen] = useState(false)
  const openRef = useRef(false)
  const lockedRef = useRef(false)
  const prevOverflowRef = useRef("")
  // 面板中心到按钮中心的位移（打开时采样视口），安卓假形变的飞行向量
  const flightRef = useRef({ x: 0, y: 0 })
  const { user } = useSimpleAuth()
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    setMounted(true)
  }, [])

  // 监听详情模态开/关（PostGrid 广播）→ 详情打开即隐藏发帖按钮。挂载时兜底读一次
  // sessionStorage.modalOpen，防错过首个事件（如详情已开时本组件才挂载）。
  useEffect(() => {
    const onChange = (e: Event) => setDetailOpen(!!(e as CustomEvent).detail)
    window.addEventListener("forum-detail-open-change", onChange)
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("modalOpen") === "true") {
      setDetailOpen(true)
    }
    return () => window.removeEventListener("forum-detail-open-change", onChange)
  }, [])

  // 空闲时预载表单代码：打开时面板与表单必须同帧挂载，FLIP 才能量到正确的目标尺寸
  useEffect(() => {
    const t = window.setTimeout(() => {
      import("@/components/create-post-modal")
        .then((m) => setFormMod(m))
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
    setFlying(false)
    // 关闭即收起表单：果冻皮渐入回绿的过程中是半透明的，若表单仍 visible 会随面板缩放
    // 扭曲透出。提前 visibility:hidden 让面板以深色空盒缩回，由回绿的果冻皮盖住。
    setFormLit(false)
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

    if (!formMod) {
      try {
        setFormMod(await import("@/components/create-post-modal"))
      } catch {
        toast({
          title: "加载失败",
          description: "发帖组件加载失败，请检查网络后重试",
          variant: "destructive",
        })
        return
      }
    }
    if (isAndroidRuntime) {
      flightRef.current = {
        x: window.innerWidth / 2 - FAB_CENTER_OFFSET,
        y: window.innerHeight / 2 - FAB_CENTER_OFFSET,
      }
    }
    lockScroll()
    openRef.current = true
    setSkinDissolve(false)
    setFormLit(false)
    setOpen(true)
    if (isAndroidRuntime) {
      // 双 rAF：等面板透明态挂载并完成首帧光栅化后再起跑
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (openRef.current) setFlying(true)
        })
      })
      // 果冻皮中途溶解：~0.24s（弹窗刚冲到最大、正在回弹的动态中）绿色就化开，露出
      // 深色面板底继续随弹簧弹到位——绿色不等弹窗站定、过渡更紧凑（弹簧时间驱动、与
      // 设备无关）
      window.setTimeout(() => {
        if (openRef.current) setSkinDissolve(true)
      }, 240)
      // 毛玻璃落位后再点亮：~0.48s（scale 已贴近 1）。缩放途中绘制毛玻璃会逐帧重采样
      // 卡顿（最初病根），故必须等到位；其间深色空盒短暂露出（约 0.08s）再浮现内容
      window.setTimeout(() => {
        if (openRef.current) setFormLit(true)
      }, 480)
    }
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

  // 安卓端假形变：不用 layout FLIP（每帧重绘闪屏），面板作为整体纹理
  // 从按钮位飞行+缩放弹入/弹出，果冻皮交叉淡出，纯 transform/opacity
  if (isAndroidRuntime) {
    const { x: flyX, y: flyY } = flightRef.current
    return createPortal(
      <>
        <AnimatePresence>
          {open && (
            <motion.div
              key="composer-overlay"
              className="fixed inset-0 z-40 bg-black/70"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              onClick={close}
            />
          )}
        </AnimatePresence>

        <div
          className={cn(
            "pointer-events-none fixed inset-0 flex items-center justify-center",
            open ? "z-50" : "z-[999]",
          )}
        >
          <AnimatePresence>
            {!open && !detailOpen && (
              <motion.button
                key="fab"
                className="pointer-events-auto absolute bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full border border-lime-300/40 bg-gradient-to-br from-lime-400 to-lime-500 text-black shadow-lg"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1, transition: { delay: 0.3, duration: 0.16 } }}
                exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.12 } }}
                onClick={handleButtonClick}
                aria-label="发布新帖子"
              >
                <Plus className="h-6 w-6" />
                <span className="absolute inset-0 rounded-full bg-lime-400/20 animate-ping" />
              </motion.button>
            )}
          </AnimatePresence>

          <AnimatePresence onExitComplete={unlockScroll}>
            {open && formMod && (
              <motion.div
                key="composer-panel"
                role="dialog"
                aria-modal
                aria-label="创建新帖子"
                className="pointer-events-auto relative overflow-hidden rounded-3xl border border-white/15 shadow-2xl"
                style={{
                  width: "min(42rem, calc(100vw - 32px))",
                  background: "rgba(21, 23, 27, 0.97)",
                }}
                initial={{ x: flyX, y: flyY, scale: 0.12, opacity: 1 }}
                animate={
                  flying
                    ? {
                        x: 0,
                        y: 0,
                        scale: 1,
                        opacity: 1,
                        transition: {
                          x: OPEN_SPRING,
                          y: OPEN_SPRING,
                          scale: OPEN_SPRING,
                        },
                      }
                    : { x: flyX, y: flyY, scale: 0.12, opacity: 1, transition: { duration: 0 } }
                }
                exit={{
                  x: flyX,
                  y: flyY,
                  scale: 0.12,
                  opacity: 0,
                  transition: {
                    x: CLOSE_SPRING,
                    y: CLOSE_SPRING,
                    scale: CLOSE_SPRING,
                    // 面板淡出推到缩回尾声：此前由回绿的果冻皮盖住深色面板底，
                    // 缩到位时面板再淡出、FAB 接力淡入，绿色全程连续无第二下突跳。
                    opacity: { delay: 0.28, duration: 0.14, ease: "easeIn" },
                  },
                }}
              >
                <div
                  className="relative max-h-[85vh] overflow-y-auto overscroll-contain"
                  style={{ visibility: formLit ? "visible" : "hidden" }}
                >
                  <formMod.CreatePostForm onClose={close} onPostCreated={handlePostCreated} />
                </div>
                {/* 果冻皮：飞行+弹簧全程盖住面板（底下毛玻璃表单此时未绘制），
                    落位后才淡出露出表单；收回时淡入变回 lime 液滴 */}
                <motion.div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-br from-lime-400 to-lime-500"
                  initial={{ opacity: 1 }}
                  animate={
                    skinDissolve
                      ? { opacity: 0, transition: { duration: 0.3, ease: "easeOut" } }
                      : { opacity: 1, transition: { duration: 0 } }
                  }
                  // 关闭时果冻皮从第 0 帧平滑渐入回绿、duration 拉到 0.3 覆盖整个缩回过程：
                  // 去掉原 delay 0.1 的「延迟后突跳」，回绿随面板缩回同步推进；面板缩到位时
                  // FAB 再淡入接力，绿色全程连续，不再「闪两下绿」。
                  exit={{ opacity: 1, transition: { duration: 0.3, ease: "easeOut" } }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </>,
      document.body,
    )
  }

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="composer-overlay"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md"
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
          {!open && !detailOpen && (
            <motion.span
              key="fab-ping"
              className="absolute bottom-6 right-6 h-14 w-14 rounded-full bg-lime-400/20 animate-ping"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.45, duration: 0.2 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            />
          )}
        </AnimatePresence>

        {(open || !detailOpen) && (
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
            background: "rgba(255, 255, 255, 0.07)",
            backdropFilter: "blur(24px) saturate(150%)",
            WebkitBackdropFilter: "blur(24px) saturate(150%)",
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
            {open && formMod && (
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
                <formMod.CreatePostForm onClose={close} onPostCreated={handlePostCreated} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
        )}

        {/* Plus 图标钉在按钮位（不随果冻体拉伸），形变启程/归位时旋转淡出入 */}
        <AnimatePresence>
          {!open && !detailOpen && (
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
