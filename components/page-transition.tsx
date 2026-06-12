"use client"

import { usePathname } from "next/navigation"
import { ReactNode, useEffect, useLayoutEffect } from "react"
import { notifyRouteCommitted } from "@/lib/view-transition-nav"

// SSR 时 useLayoutEffect 会告警，服务端退化为 useEffect（行为只在客户端有意义）
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

interface PageTransitionProps {
  children: ReactNode
}

// 页面切换转场已交给 View Transitions API（lib/view-transition-nav.ts + globals.css）。
// 之前 framer 的 mode="wait" 渐隐让每次切页都先等 ~300ms 旧页退场再进新页，拖慢切换；
// 现在：支持 VT 的浏览器走 3D 翻页快照转场，不支持的直接瞬时切页（更快）。
// data-page-transition-root 同时是全局滑动手势（page-swipe）的响应范围锚点：
// portal 到 body 的浮层（聊天、弹窗、菜单）天然不在其中、不会误触发切页。
export default function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname()

  // 新路由 commit 后放行 startViewTransition 的旧页快照冻结
  useIsoLayoutEffect(() => {
    notifyRouteCommitted()
  }, [pathname])

  return (
    <div data-page-transition-root className="w-full min-h-[calc(100vh-6rem)]">
      {children}
    </div>
  )
}
