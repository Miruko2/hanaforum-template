"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { X, Download, Link2, Loader2, RefreshCw } from "lucide-react"
import { generatePoster, type ShareInput } from "@/lib/share/poster"
import { useToast } from "@/hooks/use-toast"

interface SharePosterModalProps {
  open: boolean
  onClose: () => void
  input: ShareInput
}

// 触屏设备：安卓 WebView / 手机上 <a download> 不一定能存进相册，长按图片才稳，
// 故触屏端显式提示「长按保存」。桌面端走下载按钮。
const IS_TOUCH =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0)

// 安卓 WebView 对 backdrop-filter 支持脆弱（撕裂/碎闪），降级实底；桌面/iOS 走毛玻璃。
const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* 降级 execCommand */
  }
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

// 内容签名：既作「打开/内容变化才重新生成海报」的 effect 依赖，也用于下方 memo 比较，
// 避免父组件（音乐页 ExpandedCard 随播放进度每帧重渲）每帧新建 input 对象导致弹窗每帧重渲。
function sigOf(input: ShareInput): string {
  return input.kind === "music"
    ? `m|${input.url}|${input.title}|${input.artist}|${input.coverUrl ?? ""}|${input.hue ?? ""}`
    : `p|${input.url}|${input.title ?? ""}|${input.author}|${input.imageUrl ?? ""}|${(input.content || "").slice(0, 100)}`
}

function SharePosterModal({ open, onClose, input }: SharePosterModalProps) {
  const { toast } = useToast()
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [poster, setPoster] = useState<string | null>(null)

  // 通过 ref 读最新 input，使生成函数保持稳定（不随父组件每帧重渲染而变）。
  // 父组件（尤其 ExpandedCard 随播放进度每帧重渲）每次都会新建 input 对象，
  // 若直接依赖 input 引用，海报会被反复重生成、闪烁。
  const inputRef = useRef(input)
  inputRef.current = input

  const runGenerate = useCallback(() => {
    let cancelled = false
    setStatus("loading")
    setPoster(null)
    generatePoster(inputRef.current)
      .then((url) => {
        if (cancelled) return
        setPoster(url)
        setStatus("ready")
      })
      .catch((e) => {
        if (cancelled) return
        console.error("[share] poster generation failed", e)
        setStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 仅在「打开」或「内容签名变化」时重新生成（不受 input 对象引用抖动影响）。
  const sig = sigOf(input)

  // 打开时生成海报；关闭时不清理（保留给退场动画），下次打开重新生成
  useEffect(() => {
    if (!open) return
    return runGenerate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sig, runGenerate])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  // 刻意不锁 body 滚动：安卓 WebView 上切换 document.body.style.overflow 会触发整页重排 +
  // 合成层重组（背后 3D 卡片墙 / 毛玻璃卡 / fixed 元素全被重新合成），这正是「开/关弹窗整屏闪」
  // 的根因——对照项目抗闪标杆 image-lightbox：它 portal 全屏盖背景、自始至终不碰 body.overflow 故不闪。
  // 遮罩已全屏遮住背景，背景即便能滚也不可见，无需锁。（之前用 onExitComplete 推迟解锁只是把闪挪后、没消除。）

  const handleSave = useCallback(() => {
    if (!poster) return
    const base = input.kind === "music" ? input.title : input.title || input.author
    const name = `萤火虫之国-${(base || "分享").slice(0, 20)}.png`
    const a = document.createElement("a")
    a.href = poster
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast({ title: "已保存", description: IS_TOUCH ? "若未弹出保存，请长按图片保存到相册" : "海报已下载" })
  }, [poster, input, toast])

  const handleCopy = useCallback(async () => {
    const ok = await copyText(input.url)
    toast({
      title: ok ? "链接已复制" : "复制失败",
      description: ok ? "粘贴到微信 / QQ 即可分享" : "请手动复制地址栏链接",
      variant: ok ? undefined : "destructive",
    })
  }, [input.url, toast])

  if (typeof window === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          onClick={onClose}
          // 安卓 WebView：最外层直接做单层 opacity 淡入淡出（对标项目抗闪标杆 image-lightbox）。
          // 原来的「最外层不动画 opacity + 遮罩/面板各自 opacity 动画」三层结构，是为了让祖先 opacity<1
          // 不废掉子级毛玻璃；但安卓已降级掉 backdrop-filter（实底），该约束在安卓上不成立——
          // 三层独立 opacity 动画反而让进/出场时多个合成层并发创建/销毁，正是「开/关弹窗整屏闪」的根因
          // （即便砍了 scale 与毛玻璃仍闪，因为多 opacity 层撕裂 backing buffer）。
          // 改成单层 opacity 后，开/关各只有一个合成层做透明度过渡，与 image-lightbox 同构、不闪。
          // 桌面/iOS 保留毛玻璃，故维持「外层不动画 + 子层各自 opacity」结构（祖先 opacity 会废毛玻璃）。
          initial={IS_ANDROID ? { opacity: 0 } : { pointerEvents: "none" as const }}
          animate={IS_ANDROID ? { opacity: 1 } : { pointerEvents: "auto" as const }}
          exit={IS_ANDROID ? { opacity: 0 } : { pointerEvents: "none" as const }}
          transition={IS_ANDROID ? { duration: 0.2 } : undefined}
        >
          {/* 遮罩：暗化 +（非安卓）固定模糊。
              非安卓：自身做 opacity 淡入（兄弟节点，不影响面板毛玻璃）。
              安卓：opacity 已由最外层统一驱动，此处静态、不再独立动画（避免多层 opacity 并发撕裂）。 */}
          <motion.div
            className="absolute inset-0"
            style={{
              background: IS_ANDROID ? "rgba(6,8,6,0.8)" : "rgba(0,0,0,0.55)",
              backdropFilter: IS_ANDROID ? undefined : "blur(10px)",
              WebkitBackdropFilter: IS_ANDROID ? undefined : "blur(10px)",
            }}
            initial={IS_ANDROID ? false : { opacity: 0 }}
            animate={IS_ANDROID ? undefined : { opacity: 1 }}
            exit={IS_ANDROID ? undefined : { opacity: 0 }}
            transition={IS_ANDROID ? undefined : { duration: 0.2 }}
          />

          {/* 面板：毛玻璃（安卓 WebView 降级实底）。
              桌面/iOS：opacity + scale + y 入场（毛玻璃在同元素、CSS 允许共存，不闪）。
              安卓：完全静态——opacity 由最外层统一接管，不再做任何几何/透明度动画
              （scale 改渲染尺寸→重光栅化圆角+阴影=撕裂；y 位移虽合成器友好，但与多层 opacity 并发仍撕裂）。
              安卓路径即「外层 opacity 淡入 + 面板静态」，与 image-lightbox 安卓路径同构。 */}
          <motion.div
            className="relative z-10 flex w-full max-w-[420px] flex-col overflow-hidden rounded-3xl border border-white/15"
            style={{
              background: IS_ANDROID ? "rgba(20,22,20,0.97)" : "rgba(24,26,24,0.52)",
              backdropFilter: IS_ANDROID ? undefined : "blur(44px) saturate(160%)",
              WebkitBackdropFilter: IS_ANDROID ? undefined : "blur(44px) saturate(160%)",
              boxShadow: IS_ANDROID
                ? "0 10px 30px -10px rgba(0,0,0,0.55)"
                : "0 30px 90px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.14)",
              maxHeight: "92vh",
            }}
            initial={IS_ANDROID ? false : { opacity: 0, scale: 0.94, y: 16 }}
            animate={IS_ANDROID ? undefined : { opacity: 1, scale: 1, y: 0 }}
            exit={IS_ANDROID ? undefined : { opacity: 0, scale: 0.96, y: 8 }}
            transition={IS_ANDROID ? undefined : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <span className="text-sm font-medium text-white/90">分享海报</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className="grid h-8 w-8 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 海报预览区 */}
            <div className="flex min-h-[280px] flex-1 items-center justify-center overflow-y-auto px-5">
              {status === "loading" && (
                <div className="flex flex-col items-center gap-3 py-16 text-white/60">
                  <Loader2 className="h-7 w-7 animate-spin text-lime-400" />
                  <span className="text-sm">正在生成精美海报…</span>
                </div>
              )}
              {status === "error" && (
                <div className="flex flex-col items-center gap-3 py-16 text-white/60">
                  <span className="text-sm">海报生成失败</span>
                  <button
                    type="button"
                    onClick={runGenerate}
                    className="flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-1.5 text-sm text-white/80 hover:bg-white/10"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> 重试
                  </button>
                </div>
              )}
              {status === "ready" && poster && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={poster}
                  alt="分享海报"
                  className="w-full rounded-2xl shadow-lg"
                  style={{ maxHeight: "62vh", objectFit: "contain" }}
                  draggable={false}
                  decoding="async"
                />
              )}
            </div>

            {/* 触屏长按提示 */}
            {status === "ready" && IS_TOUCH && (
              <p className="px-5 pt-3 text-center text-xs text-white/40">长按图片可保存到相册</p>
            )}

            {/* 操作栏 */}
            <div className="flex items-center gap-3 px-5 py-4">
              <button
                type="button"
                onClick={handleSave}
                disabled={status !== "ready"}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-lime-400 px-4 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-4 w-4" /> 保存图片
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-3 text-sm font-medium text-white/90 transition-colors hover:bg-white/20"
              >
                <Link2 className="h-4 w-4" /> 复制链接
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// memo：仅当 open 或内容签名变化才重渲，挡掉音乐页父组件每帧重渲透传的新 input 对象。
// 否则弹窗在进/出场动画期间被每帧重渲，安卓 WebView 上会放大闪烁。
export default memo(
  SharePosterModal,
  (a, b) => a.open === b.open && sigOf(a.input) === sigOf(b.input),
)
