"use client"

import React from "react"
import { Play, Pause } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * 全站统一的「播放 / 暂停」主键 —— 学苹果：只有一个填充的三角（暂停＝两条填充竖条），
 * 不要圆形边框 / 磨砂底。白色填充 + 一点投影，保证在任意封面 / 深色面板上都看得清。
 *
 * 因为没有 backdrop-filter，安卓也没有鬼影顾虑（drop-shadow 现在可放心用了）。
 */
interface MusicPlayButtonProps {
  playing: boolean
  onClick: (e: React.MouseEvent) => void
  onPointerDown?: (e: React.PointerEvent) => void
  /** 命中区直径（px）；填充三角约取其 0.62 */
  size?: number
  /** 显式三角尺寸（px）；不给则按 size*0.62 估算 */
  iconSize?: number
  /** 兼容旧调用：保留但已不使用（去色 + 无边框后用不到封面主色） */
  hue?: number | null
  ariaLabel?: string
  className?: string
}

export function MusicPlayButton({
  playing,
  onClick,
  onPointerDown,
  size = 44,
  iconSize,
  ariaLabel,
  className,
}: MusicPlayButtonProps) {
  const icon = iconSize ?? Math.round(size * 0.62)
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? (playing ? "暂停" : "播放")}
      onClick={onClick}
      onPointerDown={onPointerDown}
      style={{ width: size, height: size, filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.45))" }}
      className={cn(
        "grid shrink-0 place-items-center text-white transition-transform hover:scale-110 active:scale-95",
        className,
      )}
    >
      {playing ? (
        <Pause size={icon} fill="currentColor" />
      ) : (
        <Play size={icon} fill="currentColor" className="translate-x-[1px]" />
      )}
    </button>
  )
}

export default MusicPlayButton
