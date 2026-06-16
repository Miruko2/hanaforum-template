"use client"

import { useState, useEffect, type ReactNode } from "react"
import { ThemeProvider } from "@/components/theme-provider"
import { SimpleAuthProvider } from "@/contexts/auth-context-simple"
import BannedGate from "@/components/banned-gate"
import { PostsProvider } from "@/contexts/posts-context"
import { CinemaModeProvider } from "@/contexts/cinema-mode-context"
import PageTransition from "@/components/page-transition"
import PageSwipe from "@/components/page-swipe"
import PageRibbonTransition from "@/components/page-ribbon-transition"
import RouteWarmup from "@/components/route-warmup"
import Script from "next/script"
import dynamic from "next/dynamic"

// NotificationProvider 需要同步加载（Navigation 和页面都依赖其 Context）
import { NotificationProvider } from "@/contexts/notification-context"
import { ChatUIProvider } from "@/contexts/chat-ui-context"
// 全局在线状态：登录后浏览全站期间维持心跳，供私聊窗口/大厅在线判定复用
import { PresenceProvider } from "@/contexts/presence-context"
// 音乐播放上下文提升到全站：跨页面后台续播（音频元素 + 播放状态随 app 生命周期常驻）
import { PlaybackProvider } from "@/app/music/_context/PlaybackContext"

// 延迟加载非首屏必需的纯 UI 组件
const Navigation = dynamic(() => import("@/components/navigation"), { ssr: false })
const Toaster = dynamic(
  () => import("@/components/ui/toaster").then(mod => ({ default: mod.Toaster })),
  { ssr: false }
)
const FloatingChatMount = dynamic(() => import("@/components/floating-chat-mount"), { ssr: false })
// 全站后台续播的迷你音乐卡片（仅在有曲目且不在 /music 页时显示）
const GlobalMiniPlayer = dynamic(
  () => import("@/app/music/_components/GlobalMiniPlayer").then(m => m.GlobalMiniPlayer),
  { ssr: false }
)
// 邮箱验证门禁（懒触发 OTP，仅“需验证的新用户”显示提示条/弹窗；gate 关闭时恒不显示）
const EmailVerifyGate = dynamic(() => import("@/components/email-verify-gate"), { ssr: false })
// 全员公告顶部弹窗（仿 macOS 通知；复用通知 realtime，离线下次登入补弹）
const AnnouncementPopup = dynamic(() => import("@/components/announcement-popup"), { ssr: false })

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
        <BannedGate>
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

          {/* PresenceProvider：全站在线状态（登录即心跳），供私聊窗口在线/离线、大厅在线人数复用 */}
          <PresenceProvider>
          {/* NotificationProvider 必须包裹所有使用 useNotifications 的组件（Navigation、页面等） */}
          <NotificationProvider>
            {/* CinemaModeProvider 让首页和导航栏共享同一份影院模式状态 */}
            <CinemaModeProvider>
            {/* ChatUIProvider 让导航栏入口与浮动聊天面板共享 open / 未读状态 */}
            <ChatUIProvider>
            {/* PlaybackProvider 提升到全站：音频元素与播放状态随 app 常驻，
                切到别的页面歌不断；迷你卡片（GlobalMiniPlayer）作为可见入口 */}
            <PlaybackProvider>
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

            {/* 后台续播迷你卡片：放在 PageTransition 外，切页不消失、歌继续放 */}
            <GlobalMiniPlayer />

            {/* 邮箱验证门禁：未验证新用户显示验证提示/弹窗（gate 关闭时不显示） */}
            <EmailVerifyGate />

            {/* 全员公告顶部弹窗：发公告即时弹/离线下次登入补弹（在 NotificationProvider 内） */}
            <AnnouncementPopup />

            {/* 触屏左右轻扫切页 + 丝带标题卡转场覆盖层 + 空闲时预热邻页 chunk */}
            <PageSwipe />
            <PageRibbonTransition />
            <RouteWarmup />
            </PlaybackProvider>
            </ChatUIProvider>
            </CinemaModeProvider>
          </NotificationProvider>
          </PresenceProvider>
        </PostsProvider>
        </BannedGate>
      </SimpleAuthProvider>
    </ThemeProvider>
  )
}
