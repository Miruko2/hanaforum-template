"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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

export default function SharePosterModal({ open, onClose, input }: SharePosterModalProps) {
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
  const sig =
    input.kind === "music"
      ? `m|${input.url}|${input.title}|${input.artist}|${input.coverUrl ?? ""}|${input.hue ?? ""}`
      : `p|${input.url}|${input.title ?? ""}|${input.author}|${input.imageUrl ?? ""}|${(input.content || "").slice(0, 100)}`

  // 打开时生成海报；关闭时不清理（保留给退场动画），下次打开重新生成
  useEffect(() => {
    if (!open) return
    return runGenerate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sig, runGenerate])

  // Esc 关闭 + 锁滚动
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

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
          // 最外层只切 pointerEvents、绝不动画 opacity：它是面板(backdrop-filter)的祖先，
          // 祖先 opacity<1 会废掉子级毛玻璃（先透明、动画结束才突然糊上）。淡入下放给遮罩层 + 面板各自。
          initial={{ pointerEvents: "none" as const }}
          animate={{ pointerEvents: "auto" as const }}
          exit={{ pointerEvents: "none" as const }}
          onClick={onClose}
        >
          {/* 遮罩：暗化 + 固定模糊，自身做 opacity 淡入（兄弟节点，不影响面板毛玻璃） */}
          <motion.div
            className="absolute inset-0 bg-black/55"
            style={{ backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />

          {/* 面板：毛玻璃（安卓 WebView 降级实底）。opacity/scale 动画挂毛玻璃元素自身=安全。 */}
          <motion.div
            className="relative z-10 flex w-full max-w-[420px] flex-col overflow-hidden rounded-3xl border border-white/15"
            style={{
              background: IS_ANDROID ? "rgba(20,22,20,0.97)" : "rgba(24,26,24,0.52)",
              backdropFilter: IS_ANDROID ? undefined : "blur(44px) saturate(160%)",
              WebkitBackdropFilter: IS_ANDROID ? undefined : "blur(44px) saturate(160%)",
              boxShadow: "0 30px 90px -20px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.14)",
              maxHeight: "92vh",
            }}
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
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
