"use client"

// 页面级 3D 翻页转场（View Transitions API）。
// 浏览器把新旧页面截成 GPU 快照做转场动画（样式见 globals.css 的 html[data-pt] 段），
// 动画只跑两张纹理的 transform，移动端开销远低于两页同时实时渲染。

import type { useRouter } from "next/navigation"

type AppRouter = ReturnType<typeof useRouter>

type DocumentWithVT = Document & {
  startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> }
}

// 是否支持 View Transitions（Chrome/Edge/安卓 WebView 111+、Safari 18+）。
// 模块级同步取值：驱动渲染分支的能力判定不能放 effect（首帧翻转会错位）。
export const supportsViewTransition =
  typeof document !== "undefined" &&
  typeof (document as DocumentWithVT).startViewTransition === "function"

// startViewTransition 回调要等新路由 commit 才能结束「旧页快照冻结」；
// PageTransition 在 pathname 变化的 layout effect 里调 notifyRouteCommitted 放行。
let pendingResolve: (() => void) | null = null

export function notifyRouteCommitted() {
  if (pendingResolve) {
    pendingResolve()
    pendingResolve = null
  }
}

export type FlipDirection = "next" | "prev"

// 主导航环：左右滑动 / 翻页方向都按这个顺序判定
export const PAGE_RING = ["/", "/live", "/music", "/profile"] as const

// 两个路径都在环上且不同时返回翻页方向，否则 null（调用方退化为普通 push）
export function ringDirection(fromPath: string, toPath: string): FlipDirection | null {
  const ring = PAGE_RING as readonly string[]
  const from = ring.indexOf(fromPath)
  const to = ring.indexOf(toPath)
  if (from === -1 || to === -1 || from === to) return null
  return to > from ? "next" : "prev"
}

// 带 3D 翻页转场的导航；不支持 VT / 偏好减少动效 / 页面不可见时退化为普通 push
export function navigateWithFlip(router: AppRouter, href: string, dir: FlipDirection) {
  const doc = document as DocumentWithVT
  if (
    !supportsViewTransition ||
    typeof doc.startViewTransition !== "function" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.visibilityState === "hidden"
  ) {
    router.push(href)
    return
  }

  const root = document.documentElement
  root.dataset.pt = dir

  const vt = doc.startViewTransition(() => {
    const committed = new Promise<void>((resolve) => {
      pendingResolve = resolve
    })
    router.push(href)
    // 兜底：800ms 内路由没 commit（慢网/异常）也放行动画，避免页面长时间冻结
    return Promise.race([committed, new Promise<void>((r) => setTimeout(r, 800))])
  })

  vt.finished.finally(() => {
    if (root.dataset.pt === dir) delete root.dataset.pt
  })
}
