"use client"

import { useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useCinemaMode } from "@/contexts/cinema-mode-context"
import { effectiveRingPath, navigateWithTransition, PAGE_RING } from "@/lib/view-transition-nav"

// 触屏能力：模块级同步取值
const HAS_TOUCH =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0))

// 触发阈值：快速、明确的横向轻扫才切页，避免和纵向滚动/点按混淆
const MIN_DX = 72 // 最小横向位移 px
const MAX_DT = 600 // 最长手势时长 ms
const DOMINANCE = 1.6 // 横向位移须为纵向的 1.6 倍以上

// 手势起点若在可横向滚动的容器里（图片横滑条等），让位给容器自身的滚动
function insideHorizontalScrollable(start: Element | null): boolean {
  let el: Element | null = start
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const { overflowX } = getComputedStyle(el)
      if (overflowX === "auto" || overflowX === "scroll") return true
    }
    el = el.parentElement
  }
  return false
}

// 全局左右轻扫切页（仅触屏）：首页 ⇄ 弹幕墙 ⇄ 影院 ⇄ 个人中心。
// music 不在环上（整面画布是横向拖拽交互，在它上面滑动只归画布）。
// 手指左滑 = 去环上右侧的下一页，配合标题卡遮罩转场。
export default function PageSwipe() {
  const router = useRouter()
  const pathname = usePathname()
  const { user } = useSimpleAuth()
  const { cinemaMode } = useCinemaMode()

  // 监听器只绑一次，路径/登录态/影院态/router 通过 ref 取最新值
  const pathRef = useRef(pathname)
  pathRef.current = pathname
  const loggedInRef = useRef(!!user)
  loggedInRef.current = !!user
  const cinemaRef = useRef(cinemaMode)
  cinemaRef.current = cinemaMode
  const routerRef = useRef(router)
  routerRef.current = router

  useEffect(() => {
    if (!HAS_TOUCH) return

    let startX = 0
    let startY = 0
    let startT = 0
    let tracking = false

    const onTouchStart = (e: TouchEvent) => {
      tracking = false
      if (e.touches.length !== 1) return
      // 弹窗/灯箱锁滚动期间不响应（帖子详情、图片放大等）
      if (document.body.classList.contains("modal-open") || document.body.style.overflow === "hidden") return
      const target = e.target as Element | null
      if (!target || typeof target.closest !== "function") return
      // 仅页面内容区响应；portal 到 body 的浮层（聊天、菜单、Toast）天然排除
      if (!target.closest("[data-page-transition-root]")) return
      if (
        target.closest(
          'input, textarea, select, [contenteditable="true"], audio, video, [data-page-swipe-ignore]',
        )
      )
        return
      if (insideHorizontalScrollable(target)) return
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      startT = performance.now()
      tracking = true
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      if (!t) return
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (performance.now() - startT > MAX_DT) return
      if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * DOMINANCE) return

      // 未登录时环里没有个人中心
      const ring = (PAGE_RING as readonly string[]).filter(
        (p) => p !== "/profile" || loggedInRef.current,
      )
      // 首页 + 影院模式开 = 处在虚拟影院环位
      const idx = ring.indexOf(effectiveRingPath(pathRef.current, cinemaRef.current))
      if (idx === -1) return
      // 首尾循环：首页再往回滑直接转到环尾（个人中心），环尾再往前滑回首页
      const nextIdx = (idx + (dx < 0 ? 1 : -1) + ring.length) % ring.length

      navigateWithTransition(routerRef.current, ring[nextIdx], dx < 0 ? "next" : "prev")
    }

    const onTouchCancel = () => {
      tracking = false
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true })
    window.addEventListener("touchend", onTouchEnd, { passive: true })
    window.addEventListener("touchcancel", onTouchCancel, { passive: true })
    return () => {
      window.removeEventListener("touchstart", onTouchStart)
      window.removeEventListener("touchend", onTouchEnd)
      window.removeEventListener("touchcancel", onTouchCancel)
    }
  }, [])

  return null
}
