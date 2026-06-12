"use client"

import { useState, useEffect, type ReactNode } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { SimpleAuthProvider } from "@/contexts/auth-context-simple"
import { PostsProvider } from "@/contexts/posts-context"
import { CinemaModeProvider } from "@/contexts/cinema-mode-context"
import PageTransition from "@/components/page-transition"
import PageSwipe from "@/components/page-swipe"
import RouteWarmup from "@/components/route-warmup"
import Script from "next/script"
import dynamic from "next/dynamic"

// NotificationProvider 需要同步加载（Navigation 和页面都依赖其 Context）
import { NotificationProvider } from "@/contexts/notification-context"
import { ChatUIProvider } from "@/contexts/chat-ui-context"

// 延迟加载非首屏必需的纯 UI 组件
const Navigation = dynamic(() => import("@/components/navigation"), { ssr: false })
const Toaster = dynamic(
  () => import("@/components/ui/toaster").then(mod => ({ default: mod.Toaster })),
  { ssr: false }
)
const FloatingChatMount = dynamic(() => import("@/components/floating-chat-mount"), { ssr: false })

// 延迟加载包装器：等浏览器空闲后再挂载，让首屏内容优先抢占主线程。
// requestIdleCallback 在不支持的浏览器（Safari < 18.4）上回退到 setTimeout。
function LazyMount({ children, timeout = 500 }: { children: ReactNode; timeout?: number }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const ric = (window as Window).requestIdleCallback
    if (typeof ric === "function") {
      const id = ric(() => setMounted(true), { timeout })
      return () => (window as Window).cancelIdleCallback?.(id)
    }
    const t = setTimeout(() => setMounted(true), 200)
    return () => clearTimeout(t)
  }, [timeout])
  if (!mounted) return null
  return <>{children}</>
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <SimpleAuthProvider>
        <PostsProvider>
          <Script id="page-refresh-detection" strategy="beforeInteractive">
            {`
              if (typeof sessionStorage !== 'undefined') {
                const modalOpen = sessionStorage.getItem('modalOpen');
                if (modalOpen === 'true') {
                  sessionStorage.setItem('pageRefreshed', 'true');
                }
                const scrollPos = sessionStorage.getItem('forumScrollPosition');
                if (scrollPos) {
                  window.addEventListener('load', function() {
                    setTimeout(function() {
                      window.scrollTo({ top: parseInt(scrollPos, 10), behavior: 'auto' });
                    }, 100);
                  });
                }
              }
            `}
          </Script>

          {/* NotificationProvider 必须包裹所有使用 useNotifications 的组件（Navigation、页面等） */}
          <NotificationProvider>
            {/* CinemaModeProvider 让首页和导航栏共享同一份影院模式状态 */}
            <CinemaModeProvider>
            {/* ChatUIProvider 让导航栏入口与浮动聊天面板共享 open / 未读状态 */}
            <ChatUIProvider>
            {/* 首屏内容：立即渲染 */}
            <PageTransition>
              {children}
            </PageTransition>

            {/* 延迟加载：导航栏（idle 时挂载，最长 1s 兜底） */}
            <LazyMount timeout={1000}>
              <Navigation />
            </LazyMount>

            {/* Toaster 不紧急，最长 2s 兜底 */}
            <LazyMount timeout={2000}>
              <Toaster />
            </LazyMount>

            {/* 全站浮动聊天室：放在 PageTransition 外，不随页面切换动画消失 */}
            <FloatingChatMount />

            {/* 触屏左右轻扫切页（带 3D 翻页转场）+ 空闲时预热邻页 chunk */}
            <PageSwipe />
            <RouteWarmup />
            </ChatUIProvider>
            </CinemaModeProvider>
          </NotificationProvider>
        </PostsProvider>
      </SimpleAuthProvider>
    </ThemeProvider>
  )
}
