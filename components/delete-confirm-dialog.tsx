"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  useMotionValueEvent,
  animate,
} from "framer-motion"
import { Trash2, Loader2, ChevronsRight } from "lucide-react"

interface DeleteConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  /** 删除进行中：滑块钉在终点并转圈、整条禁用 */
  loading?: boolean
  /** 可选：被删对象的预览标题（如帖子标题），展示在正文区 */
  title?: string
}

// 拖拽手柄（圆形头像位）直径
const HANDLE = 48
// 必须把滑块拖到最右端（距终点 END_SLOP 内）松手才确认；只留极小容差兜底测量/回弹误差，
// 避免「没到底就删」。轨道右端被 dragConstraints 钉死，拖到底必然命中，故 6px 足够好按。
const END_SLOP = 6

/**
 * 删除确认弹窗：长椭圆胶囊「滑动确认」。
 *
 * 视觉语言复刻站点私信通知条（components/announcement-popup.tsx 的 .ann-pop-card）：
 * 长椭圆磨砂胶囊、左圆形头像位、右「X + 圆环」、中间内容。这里把它从「通知」改造成
 * 「危险操作确认」——
 *   - 左侧圆形手柄（垃圾桶图标，玫红）= 可拖拽滑块；
 *   - 右端「圆环」= 停靠目标圈，把手柄拖到底嵌入它松手 = 确认删除（没到底则弹回，防误删）；
 *   - 点击胶囊外的空白遮罩 / ESC = 取消（不再设独立 X 键：滑块行程要占满整条，留 X 反而够不到）。
 * 用「滑动」替代单击确认，天然防误触（删帖不可撤销）。
 *
 * ⚠️ 毛玻璃铁律（此处曾翻车「一直透明、没磨砂」）：backdrop-filter 一旦有任一【祖先】
 * 元素建立了 "backdrop root"，子孙就只能采样到那个祖先、采不到页面背景 → 模糊彻底失效。
 * 建立 backdrop root 的属性：opacity<1、filter(哪怕 blur0)、will-change 含上述属性、
 * mask/clip-path、mix-blend-mode、isolation、preserve-3d；transform(scale/translate) 不会建立。
 * 所以：
 *   1) 最外层全屏 wrapper 只做布局，绝不挂 opacity 动画 / willChange:"opacity"——否则它会成为
 *      backdrop root，把遮罩与胶囊的毛玻璃全部废掉。
 *   2) 入场 opacity 淡入直接挂在【毛玻璃本体那一个元素上】（遮罩、胶囊各自淡入）；同一元素上
 *      backdrop-filter 与 opacity/transform 合法共存，毛玻璃【从首帧就在】。
 * 背景详见 app/globals.css 的 .glass-card 注释。
 */
export default function DeleteConfirmDialog({
  open,
  onClose,
  onConfirm,
  loading = false,
  title,
}: DeleteConfirmDialogProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const confirmedRef = useRef(false) // 防止滑动+loading 重复触发 onConfirm
  // 轨道可滑动距离（轨道宽 - 手柄宽）；首帧测量前为 0，手柄不可动
  const [maxX, setMaxX] = useState(0)
  // 是否已滑入「松手即删」阈值区（驱动文案/配色切换）
  const [near, setNear] = useState(false)

  const x = useMotionValue(0)
  // 进度填充宽度 = 手柄右沿位置
  const fillWidth = useTransform(x, (v) => v + HANDLE)
  // 归一化进度 0..1，驱动方向箭头淡出
  const progress = useTransform(x, [0, Math.max(maxX, 1)], [0, 1])
  const hintOpacity = useTransform(progress, [0, 0.55], [0.85, 0])

  // 测量轨道可滑距离
  const measure = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    setMaxX(Math.max(0, el.offsetWidth - HANDLE))
  }, [])

  // 打开：锁滚 + 复位 + 测量；关闭/卸载：解锁 + 复位滑块（解锁放 cleanup，保证删帖成功卸载时也能恢复滚动）
  useEffect(() => {
    if (!open) {
      x.set(0)
      setNear(false)
      document.body.style.overflow = ""
      return
    }
    document.body.style.overflow = "hidden"
    confirmedRef.current = false
    x.set(0)
    setNear(false)
    const raf = requestAnimationFrame(measure) // 等胶囊入场布局后量宽
    return () => {
      cancelAnimationFrame(raf)
      document.body.style.overflow = ""
    }
  }, [open, measure, x])

  // 窗口尺寸变化时重新测量
  useEffect(() => {
    if (!open) return
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [open, measure])

  // ESC 关闭（删除中禁用）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, loading, onClose])

  // 删除中：把滑块钉到终点（呼应「已确认」），整条禁用
  useEffect(() => {
    if (loading && maxX > 0) x.set(maxX)
  }, [loading, maxX, x])

  // 删除失败兜底：有的调用方（如评论删除）在 onConfirm 失败后保持弹窗打开，
  // loading 会 true→false 而 open 仍为 true。此时滑块卡在终点、confirmedRef 已置，无法重试，
  // 故复位滑块并清确认标记，允许再次滑动删除。（帖子删除失败会关弹窗，open 转 false，不触发此分支。）
  const prevLoadingRef = useRef(false)
  useEffect(() => {
    if (prevLoadingRef.current && !loading && open && confirmedRef.current) {
      confirmedRef.current = false
      setNear(false)
      animate(x, 0, { type: "spring", stiffness: 600, damping: 38 })
    }
    prevLoadingRef.current = loading
  }, [loading, open, x])

  // 到达最右端时切换「松手即删」态（与确认判定同一条件，保证提示与行为一致；
  // 值不变时 React 自动 bail，不会逐帧重渲染）
  useMotionValueEvent(x, "change", (v) => {
    if (maxX <= 0) return
    setNear(v >= maxX - END_SLOP)
  })

  const triggerConfirm = () => {
    if (confirmedRef.current) return
    confirmedRef.current = true
    animate(x, maxX, { type: "spring", stiffness: 500, damping: 40 })
    onConfirm()
  }

  const handleDragEnd = () => {
    if (loading) return
    if (maxX > 0 && x.get() >= maxX - END_SLOP) {
      triggerConfirm() // 拖到最右端才确认
    } else {
      animate(x, 0, { type: "spring", stiffness: 600, damping: 38 }) // 没到底 → 弹回原位
    }
  }

  const cancel = () => {
    if (!loading) onClose()
  }

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {open && (
        /* 最外层 wrapper 只做布局：不挂 opacity 动画、不挂 willChange:"opacity"，否则成为 backdrop
           root，废掉遮罩/胶囊的 backdrop-filter（见顶部注释）。 */
        <motion.div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
          {/* 背景遮罩：毛玻璃常开，入场只淡入 opacity；点击空白处 = 取消 */}
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              background: "rgba(8, 8, 14, 0.30)",
              backdropFilter: "blur(14px) saturate(150%)",
              WebkitBackdropFilter: "blur(14px) saturate(150%)",
            }}
            onClick={cancel}
          />

          {/* 长椭圆胶囊 */}
          <motion.div
            className="relative flex items-center gap-3"
            style={{
              width: "min(94vw, 460px)",
              padding: "10px 12px",
              borderRadius: 9999,
              border: "1px solid rgba(244,63,94,0.28)",
              background: "rgba(22, 16, 20, 0.62)",
              backdropFilter: "blur(26px) saturate(160%)",
              WebkitBackdropFilter: "blur(26px) saturate(160%)",
              boxShadow:
                "0 16px 44px rgba(0,0,0,0.5), 0 0 28px rgba(244,63,94,0.14), inset 0 1px 0 rgba(255,255,255,0.10)",
              overflow: "hidden",
              willChange: "transform, opacity",
              transform: "translateZ(0)",
            }}
            initial={{ scale: 0.96, y: 10, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.97, y: 6, opacity: 0 }}
            transition={{ type: "spring", stiffness: 340, damping: 30, mass: 0.8 }}
          >
            {/* 玻璃上沿高光线（与站点其它毛玻璃面板同款反光） */}
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                left: "14%",
                right: "14%",
                height: 1,
                pointerEvents: "none",
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,0.32), transparent)",
              }}
            />

            {/* 滑动轨道：进度填充 + 文案 + 方向箭头 + 拖拽手柄 */}
            <div ref={trackRef} className="relative min-w-0 flex-1" style={{ height: HANDLE }}>
              {/* 进度填充：宽度跟随手柄右沿 */}
              <motion.div
                aria-hidden
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: fillWidth,
                  borderRadius: 9999,
                  background:
                    "linear-gradient(90deg, rgba(244,63,94,0.32), rgba(244,63,94,0.14))",
                  pointerEvents: "none",
                }}
              />

              {/* 文案：从手柄右侧起，避免初始被盖住 */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: HANDLE + 12,
                  right: HANDLE + 8,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: ".02em",
                    color: near ? "#fb7185" : "#f43f5e",
                    marginBottom: 1,
                    transition: "color .15s ease",
                    whiteSpace: "nowrap",
                  }}
                >
                  {near ? "松手即删除 · 不可撤销" : "危险操作 · 滑动删除"}
                </span>
                <span
                  style={{
                    fontSize: 13.5,
                    fontWeight: 700,
                    color: "#fff",
                    lineHeight: 1.25,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {title ? `「${title}」` : "删除这个帖子？"}
                </span>
              </div>

              {/* 右端停靠目标圆环：手柄拖到底正好嵌入它（替代原 X 取消键）。
                  内含方向箭头随进度淡出；到达终点时圆环点亮玫红 + 外发光（halo 透过手柄外圈可见）。 */}
              <motion.div
                aria-hidden
                style={{
                  position: "absolute",
                  right: 0,
                  top: 0,
                  width: HANDLE,
                  height: HANDLE,
                  borderRadius: 9999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: near
                    ? "1.5px solid rgba(244,63,94,0.9)"
                    : "1.5px dashed rgba(244,63,94,0.5)",
                  background: near ? "rgba(244,63,94,0.16)" : "rgba(244,63,94,0.06)",
                  boxShadow: near ? "0 0 16px rgba(244,63,94,0.45)" : "none",
                  transition: "background .15s ease, border-color .15s ease, box-shadow .15s ease",
                  pointerEvents: "none",
                }}
              >
                <motion.span style={{ opacity: hintOpacity, display: "flex" }}>
                  <ChevronsRight className="h-4 w-4 text-rose-400" strokeWidth={2.4} />
                </motion.span>
              </motion.div>

              {/* 拖拽手柄（圆形头像位）：滑到右侧确认删除 */}
              <motion.div
                drag={loading ? false : "x"}
                dragConstraints={{ left: 0, right: maxX }}
                dragElastic={0.04}
                dragMomentum={false}
                onDragEnd={handleDragEnd}
                whileTap={loading ? undefined : { scale: 0.94 }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  x,
                  width: HANDLE,
                  height: HANDLE,
                  borderRadius: 9999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "linear-gradient(135deg, #f43f5e, #e11d48)",
                  border: "1px solid rgba(255,255,255,0.22)",
                  boxShadow:
                    "0 6px 18px -4px rgba(244,63,94,0.7), inset 0 1px 0 rgba(255,255,255,0.25)",
                  cursor: loading ? "default" : "grab",
                  touchAction: "none",
                  zIndex: 2,
                }}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 text-white animate-spin" />
                ) : (
                  <Trash2 className="h-5 w-5 text-white" strokeWidth={2.2} />
                )}
              </motion.div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
