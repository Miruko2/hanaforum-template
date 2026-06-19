"use client"

import { useEffect, useRef } from "react"
import { usePlaybackWall } from "../_context/PlaybackContext"
import { useMyBackgroundUrl } from "@/hooks/use-my-background"
import { CrossfadeBackground } from "@/components/crossfade-background"

// 站点默认底图（深色霓虹夜景）。用户未在个人页设置自定义背景时回落到它。
const DEFAULT_BACKDROP = "/mos-background.webp"

/**
 * 卡片墙背景：用户设置过首页背景则用它、否则站点默认底图（/mos-background.webp）。切换背景时
 * 高斯模糊渐入交叉淡入（CrossfadeBackground，与首页同款）。背景保持清晰 ——
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
  // 个人页设置的首页背景 → 同步作为 music 页底图（与首页/全站底图共用 useMyBackgroundUrl）；
  // null 时由 CrossfadeBackground 的 baseUrl 默认底图垫底。切路由重挂载会重取、无需 realtime。
  const custom = useMyBackgroundUrl()
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
      {/* 默认底图垫底 + 自定义首页背景高斯模糊渐入叠上（与首页同款 CrossfadeBackground）；
          saturate 轻提饱和、与原来一致。背景本身不模糊，毛玻璃由卡片 backdrop-filter 完成。 */}
      <CrossfadeBackground url={custom} baseUrl={DEFAULT_BACKDROP} extraFilter="saturate(1.08)" />
      {/* 律动暗化遮罩：opacity 由上面 rAF 随音频强度脉动；初始 0.3（接近暂停态）。 */}
      <div
        ref={dimRef}
        className="absolute inset-0"
        style={{ background: "#070910", opacity: 0.3 }}
      />
    </div>
  )
}
