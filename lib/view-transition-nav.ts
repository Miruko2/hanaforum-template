"use client"

// 页面切换转场调度。
// 默认走「丝带标题卡」遮罩转场（components/page-ribbon-transition.tsx）：
// 覆盖 → 换页 → 揭开。换页发生在全屏遮蔽的瞬间，路由提交的延迟被遮罩吸收，
// 用户永远看不到加载中间态；且不依赖 View Transitions API，
// 老 WebView / iOS Safari 17- 也有完整动画。
// 立方体转场（View Transitions 快照翻转，样式见 globals.css 的 html[data-pt] 段）
// 保留为备选，把 TRANSITION_MODE 改成 "cube" 即可切回。

import type { useRouter } from "next/navigation"

type AppRouter = ReturnType<typeof useRouter>

type DocumentWithVT = Document & {
  startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> }
}

export type TransitionMode = "ribbon" | "cube"
// as 断言保住联合类型：直接写字面量会被 TS 收窄、后面的分支比较报「无重叠」
export const TRANSITION_MODE = "ribbon" as TransitionMode

// 是否支持 View Transitions（Chrome/Edge/安卓 WebView 111+、Safari 18+）。
// 模块级同步取值：驱动渲染分支的能力判定不能放 effect（首帧翻转会错位）。
export const supportsViewTransition =
  typeof document !== "undefined" &&
  typeof (document as DocumentWithVT).startViewTransition === "function"

// 安卓 WebView 的合成器对「大量常驻图层 + 持续动画」很敏感：连续快滑时图层
// 频繁创建/销毁会跟不上 GPU 纹理回收，表现为闪屏 / 鬼影 / 卡顿。转场组件据此
// 在安卓上走精简渲染（去掉常驻无限动画图层、降低图层数、拉长冷却）。
// 模块级同步取值：要在首次渲染遮罩时就决定渲染分支，不能放进 effect。
export const isAndroidRuntime =
  typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)

// 转场要等新路由 commit 才能进入揭开阶段；
// PageTransition 在 pathname 变化的 layout effect 里调 notifyRouteCommitted 放行。
let pendingResolve: (() => void) | null = null

export function notifyRouteCommitted() {
  if (pendingResolve) {
    pendingResolve()
    pendingResolve = null
  }
}

// 等待下一次路由 commit；超时兜底放行，慢网/异常时不至于卡死转场
export function waitForRouteCommit(timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      if (pendingResolve === finish) pendingResolve = null
      resolve()
    }
    pendingResolve = finish
    setTimeout(finish, timeoutMs)
  })
}

export type FlipDirection = "next" | "prev"

// "/cinema" 是虚拟环位：实际路由是首页 + 影院模式开。
// 转场执行器（page-ribbon-transition）负责把它落成「push("/") + setCinemaMode(true)」；
// 各种普通 push 兜底走 ?cinema=1 深链（CinemaModeProvider 消费）。
export const CINEMA_RING_PATH = "/cinema"

// 当前所在环位：首页 + 影院模式开 = 虚拟影院位
export function effectiveRingPath(pathname: string, cinemaOn: boolean): string {
  return pathname === "/" && cinemaOn ? CINEMA_RING_PATH : pathname
}

// 虚拟环位翻译成真实可 push 的 href（转场不可用时的兜底）
function toRealHref(href: string): string {
  return href === CINEMA_RING_PATH ? "/?cinema=1" : href
}

// 滑动切页环：首页 ⇄ 弹幕墙 ⇄ 影院 ⇄ 个人中心。
// music 不在环上 —— 它整面画布是横向拖拽交互，没法支持滑动翻页，只走导航栏。
export const PAGE_RING = ["/", "/live", CINEMA_RING_PATH, "/profile"] as const

// 方向判定顺序：在环的基础上保留 music（导航栏点击进出 music 仍带方向转场）
const NAV_ORDER = ["/", "/live", CINEMA_RING_PATH, "/music", "/profile"] as const

// 两个路径都在导航序上且不同时返回翻页方向，否则 null（调用方退化为普通 push）
export function ringDirection(fromPath: string, toPath: string): FlipDirection | null {
  const order = NAV_ORDER as readonly string[]
  const from = order.indexOf(fromPath)
  const to = order.indexOf(toPath)
  if (from === -1 || to === -1 || from === to) return null
  return to > from ? "next" : "prev"
}

// ===== 丝带转场执行器：覆盖层组件挂载时注册自己 =====
type RibbonNavigator = (href: string, dir: FlipDirection) => void
let ribbonNavigator: RibbonNavigator | null = null

export function registerRibbonNavigator(fn: RibbonNavigator): () => void {
  ribbonNavigator = fn
  return () => {
    if (ribbonNavigator === fn) ribbonNavigator = null
  }
}

// 统一入口：带方向的页面切换转场。
// 偏好减少动效 / 页面不可见 → 普通 push；丝带执行器未挂载 → 落到立方体路径
// （其内部对不支持 VT 的浏览器再退化为普通 push）。
export function navigateWithTransition(router: AppRouter, href: string, dir: FlipDirection) {
  if (typeof window === "undefined") return
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.visibilityState === "hidden"
  ) {
    router.push(toRealHref(href))
    return
  }
  if (TRANSITION_MODE === "ribbon" && ribbonNavigator) {
    ribbonNavigator(href, dir)
    return
  }
  navigateWithFlip(router, toRealHref(href), dir)
}

// 立方体 3D 翻页（View Transitions API）：浏览器把新旧页面截成 GPU 快照做转场，
// 动画只跑两张纹理的 transform。不支持 VT 时退化为普通 push。
export function navigateWithFlip(router: AppRouter, href: string, dir: FlipDirection) {
  const doc = document as DocumentWithVT
  if (!supportsViewTransition || typeof doc.startViewTransition !== "function") {
    router.push(href)
    return
  }

  const root = document.documentElement
  root.dataset.pt = dir

  const vt = doc.startViewTransition(() => {
    // 兜底：800ms 内路由没 commit（慢网/异常）也放行动画，避免页面长时间冻结
    const committed = waitForRouteCommit(800)
    router.push(href)
    return committed
  })

  vt.finished.finally(() => {
    if (root.dataset.pt === dir) delete root.dataset.pt
  })
}
