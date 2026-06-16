"use client"

import { Fragment, useMemo } from "react"
import { parseStickerText } from "@/lib/stickers"
import { StickerImage } from "./sticker-image"

interface StickerTextProps {
  text?: string | null
}

/**
 * 把含 [s:name] 标记的纯文本渲染为「文本 + 内联表情」。
 *
 * - 无任何表情标记时直接回退为原文本（零额外包裹，不影响 white-space / break 等）。
 * - 文本片段用 Fragment 直出，仍是父级 <p> 的直接文本子节点，
 *   继承 whitespace-pre-line / pre-wrap / break-all 等排版。
 * - 内容只有表情（没有其他文字）时放大显示（jumbo）。
 */
export function StickerText({ text }: StickerTextProps) {
  const segments = useMemo(() => parseStickerText(text ?? ""), [text])

  const hasSticker = segments.some((s) => s.type === "sticker")
  if (!hasSticker) return <>{text}</>

  // 所有文本片段都是空白 → 内容纯表情 → 放大
  const jumbo = segments.every((s) => s.type === "sticker" || s.value.trim() === "")

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === "sticker" ? (
          <StickerImage key={i} name={seg.name} alt={seg.name} variant={jumbo ? "jumbo" : "inline"} />
        ) : (
          <Fragment key={i}>{seg.value}</Fragment>
        ),
      )}
    </>
  )
}
