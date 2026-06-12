"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// 模块级标记：全站只预热一次
let warmed = false

// 空闲时预热主导航环的路由 chunk 与 ssr:false 重组件 chunk，
// 消除切到 live / music 时「正在接入信号... / Loading…」的黑屏等待。
// 手动 import() 与 next/dynamic 的 loader 命中同一 webpack 模块缓存，
// 切页时 dynamic 直接解析、几乎不再展示 loading 兜底。
export default function RouteWarmup() {
  const router = useRouter()

  useEffect(() => {
    const warm = () => {
      if (warmed) return
      warmed = true
      // 1) 路由 chunk（页面框架）
      for (const href of ["/", "/live", "/music", "/profile"]) {
        try {
          router.prefetch(href)
        } catch {
          // 静态导出等场景下 prefetch 不可用时忽略
        }
      }
      // 2) ssr:false 的重组件 chunk
      import("@/components/live-wall-content").catch(() => {})
      import("@/app/music/_components/MusicCanvas").catch(() => {})
      import("@/app/music/_components/MusicPlayer").catch(() => {})
      import("@/app/music/_components/HistoryPanel").catch(() => {})
      import("@/app/music/_components/ExpandedCard").catch(() => {})
      import("@/app/music/_components/SourceToggle").catch(() => {})
      import("@/app/music/_components/MusicLibraryEditor").catch(() => {})
    }

    // 等首屏渲染与数据请求安顿后再预热，不抢首页的主线程/带宽
    const w = window as Window
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(warm, { timeout: 5000 })
      return () => w.cancelIdleCallback?.(id)
    }
    const t = setTimeout(warm, 3000)
    return () => clearTimeout(t)
  }, [router])

  return null
}
