"use client"

import { useCallback, useState } from "react"
import dynamic from "next/dynamic"
import { Share2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ShareInput } from "@/lib/share/poster"

// 弹窗（含 canvas 绘制 + qrcode 库）按需加载：首次点击才拉对应 chunk，
// 主包 / 各页首屏体积不受影响。
const SharePosterModal = dynamic(() => import("./share-poster-modal"), { ssr: false })

interface ShareButtonProps {
  input: ShareInput
  /** icon = 仅图标圆钮；pill = 图标+文字胶囊 */
  variant?: "icon" | "pill"
  label?: string
  className?: string
}

export default function ShareButton({ input, variant = "icon", label = "分享", className }: ShareButtonProps) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setLoaded(true)
    setOpen(true)
  }, [])

  return (
    <>
      {variant === "pill" ? (
        <button
          type="button"
          onClick={handleClick}
          aria-label={label}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white",
            className,
          )}
        >
          <Share2 className="h-5 w-5" />
          <span>{label}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          aria-label={label}
          title={label}
          className={cn(
            "grid place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white",
            className,
          )}
        >
          <Share2 className="h-5 w-5" />
        </button>
      )}

      {loaded && <SharePosterModal open={open} onClose={() => setOpen(false)} input={input} />}
    </>
  )
}
