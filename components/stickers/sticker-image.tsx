"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { getCachedStickerUrl, resolveStickerUrl } from "@/lib/stickers"

type StickerVariant = "inline" | "jumbo" | "fill"

interface StickerImageProps {
  name: string
  alt?: string
  className?: string
  /**
   * inline —— 随文字大小的行内表情（混在文字里时用，默认）
   * jumbo  —— 固定大图（内容只有表情时用）
   * fill   —— 充满父容器（表情选择器格子里用）
   */
  variant?: StickerVariant
  onClick?: (src: string) => void
}

// 行内尺寸随文字缩放：约 1.8 个字高，基线微下沉以对齐文字
const INLINE_STYLE: React.CSSProperties = {
  height: "1.8em",
  width: "auto",
  verticalAlign: "-0.45em",
}

const VARIANT_CLASS: Record<StickerVariant, string> = {
  inline: "inline-block rounded object-contain",
  jumbo: "inline-block h-20 w-20 max-w-full rounded-lg object-contain align-middle",
  fill: "h-full w-full object-contain",
}

/**
 * 展示单个表情包：复用 lib/stickers 的扩展名探测与整页缓存。
 * 首帧命中缓存即直出；未命中时后台探测，期间占位避免布局跳动；全部失败则不渲染。
 */
export function StickerImage({ name, alt = "", className, variant = "inline", onClick }: StickerImageProps) {
  const [src, setSrc] = useState<string | null | undefined>(() => getCachedStickerUrl(name))

  useEffect(() => {
    if (src !== undefined) return // 已解析（命中缓存）
    let cancelled = false
    resolveStickerUrl(name).then((url) => {
      if (!cancelled) setSrc(url)
    })
    return () => {
      cancelled = true
    }
  }, [name, src])

  // 四种扩展名都失败：不占位、不渲染
  if (src === null) return null

  const baseClass = VARIANT_CLASS[variant]
  const style = variant === "inline" ? INLINE_STYLE : undefined

  // 解析中：占位（保持空间但不可见），避免文字回流
  if (!src) {
    return <span className={baseClass} style={{ ...style, visibility: "hidden" }} aria-hidden />
  }

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      className={cn(baseClass, onClick && "cursor-pointer", className)}
      style={style}
      onClick={
        onClick
          ? (e) => {
              // 阻止冒泡：避免触发父级（评论行/帖子容器）的点击
              e.stopPropagation()
              onClick(src)
            }
          : undefined
      }
    />
  )
}
