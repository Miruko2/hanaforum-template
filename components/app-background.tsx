"use client"

import { useMyBackgroundUrl } from "@/hooks/use-my-background"
import { CrossfadeBackground } from "@/components/crossfade-background"

// 全站自定义底图层：渲染登录用户设置的首页背景（fixed, z-index:-1），叠在 layout 默认底图之上；
// 未设置 / 还原后渲染空，露出 layout 默认底图（故不传 baseUrl）。切换时高斯模糊渐入交叉淡入
// （见 components/crossfade-background.tsx，与 music 页同款）。挂在 providers 的
// SimpleAuthProvider 内、PageTransition 外，避免被切页动画的 opacity 波及。
export default function AppBackground() {
  const custom = useMyBackgroundUrl()
  return (
    <div
      aria-hidden
      style={{ position: "fixed", inset: 0, zIndex: -1, overflow: "hidden", pointerEvents: "none" }}
    >
      <CrossfadeBackground url={custom} />
    </div>
  )
}
