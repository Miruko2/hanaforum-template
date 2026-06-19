"use client"

import { useEffect, useRef } from "react"
import { usePlaybackWall } from "../_context/PlaybackContext"

/**
 * 站点同款底图（/mos-background.webp，深色霓虹夜景）作为卡片墙背景，保持清晰 ——
 * 毛玻璃由卡片自己的 backdrop-filter 完成（糊它身后那块），背景本身不模糊。
 *
 * 播放时的「呼吸」律动：一层黑色遮罩的 opacity 由 rAF 随音频强度改（intensity 高→更透、
 * 背景正常；低→更黑、背景变暗）—— 整屏背景忽暗忽明，卡片透出的背景也跟着脉动。opacity
 * 是合成属性、不触发重绘/重模糊，开销极小。暂停时 getAudioIntensity 恒 1 → 遮罩稳定不闪。
 * 不用每卡订阅 → 单点 rAF，零额外重渲染。
 */
export function ImageBackdrop() {
  // 墙专用低频上下文：只取 getAudioIntensity（稳定引用，不随高频 value 重建）。
  const { getAudioIntensity } = usePlaybackWall()
  const dimRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let mounted = true
    let raf = 0
    let prev = ""
    const loop = () => {
      if (!mounted) return
      const intensity = getAudioIntensity() // 0..1，暂停恒返回 1（稳定）
      // 遮罩透明度：intensity=1（强拍/暂停）→ 0.22（背景正常）；intensity=0（弱）→ 0.66
      // （明显变暗）。幅度拉大让「忽暗忽明」明显；2% 步进量化 + 脏检查，避免每帧写字符串。
      const dim = (0.22 + (1 - intensity) * 0.44).toFixed(2)
      if (dim !== prev) {
        if (dimRef.current) dimRef.current.style.opacity = dim
        prev = dim
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      mounted = false
      cancelAnimationFrame(raf)
    }
  }, [getAudioIntensity])

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/mos-background.webp"
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          // 背景保持清晰（毛玻璃由卡片 backdrop-filter 完成），只轻微提饱和。
          filter: "saturate(1.08)",
          transform: "scale(1.04)",
        }}
        draggable={false}
      />
      {/* 律动暗化遮罩：opacity 由上面 rAF 随音频强度脉动；初始 0.3（接近暂停态）。 */}
      <div
        ref={dimRef}
        className="absolute inset-0"
        style={{ background: "#070910", opacity: 0.3 }}
      />
    </div>
  )
}
