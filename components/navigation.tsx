"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { LogOut, User, Settings, Menu, X, PlusCircle } from "lucide-react"
import Link from "next/link"
import { supabase } from "@/lib/supabaseClient"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import NotificationBell from "@/components/notification-bell"
import CategoryMenu from "@/components/category-menu"
import { useCinemaMode } from "@/contexts/cinema-mode-context"
import { isValidCategory } from "@/lib/categories"
import { Clapperboard, Zap, Music } from "lucide-react"

export default function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, signOut, isAdmin } = useSimpleAuth()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isNavVisible, setIsNavVisible] = useState(true)
  // lastScrollY 只在滚动 handler 内做比较，不参与渲染，用 ref 避免 set 触发
  // useEffect 重新绑/解绑 scroll 监听器（之前每帧重绑一次）
  const lastScrollYRef = useRef(0)
  const [isScrolled, setIsScrolled] = useState(false)
  // 当前激活的分类（仅用于 CategoryMenu 的高亮态）— useSearchParams 自动跟随 URL
  const activeCategory = useMemo(() => {
    const raw = searchParams?.get("category") || null
    return isValidCategory(raw) ? raw : null
  }, [searchParams])
  // 影院模式由 CinemaModeProvider 统一管理（替代之前的 CustomEvent 总线）
  const { cinemaMode, toggleCinemaMode: ctxToggleCinemaMode } = useCinemaMode()
  // 用户头像
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  
  // 确保组件在客户端渲染
  useEffect(() => {
    setMounted(true)
  }, [])

  // 获取用户头像
  useEffect(() => {
    if (!user?.id) {
      setAvatarUrl(null)
      return
    }

    const fetchAvatar = async () => {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("avatar_url")
          .eq("id", user.id)
          .single()

        if (!error && data?.avatar_url) {
          setAvatarUrl(data.avatar_url)
        } else {
          setAvatarUrl(null)
        }
      } catch (err) {
        // 只在开发环境打印异常，避免生产控制台噪音
        if (process.env.NODE_ENV === 'development') {
          console.error('Navigation: 获取头像异常:', err)
        }
        setAvatarUrl(null)
      }
    }

    fetchAvatar()
  }, [user?.id])

  // activeCategory 已通过 useSearchParams 自动跟随 URL，无需手动同步

  // 切换影院模式。如果当前不在首页，则先跳转到首页并带上 ?cinema=1，
  // CinemaModeProvider 会消费这个参数并开启影院模式。
  const toggleCinemaMode = () => {
    if (pathname !== "/") {
      router.push("/?cinema=1")
      return
    }
    ctxToggleCinemaMode()
  }

  // 处理登出
  const handleSignOut = async () => {
    try {
      console.log('Navigation: 开始登出流程')
      
      // 先清除本地存储数据
      if (typeof window !== 'undefined') {
        const authKeys = [
          'sb-session', 'sb-https-session',
          'sb-auth-token', 'sb-https-auth-token',
          'supabase.auth.token'
        ]
        authKeys.forEach(key => {
          try {
            localStorage.removeItem(key)
            sessionStorage.removeItem(key)
          } catch (e) {
            console.error(`清除存储项 ${key} 失败:`, e)
          }
        })
      }
      
      // 执行Supabase登出
      await signOut()
      
      // 延迟一下确保状态更新
      await new Promise(resolve => setTimeout(resolve, 500))
      
      console.log('Navigation: 登出成功，刷新页面')
      
      // 强制刷新页面，确保状态完全重置
      window.location.href = '/?logout=' + Date.now()
    } catch (error) {
      console.error('Navigation: 登出失败:', error)
      
      // 出错时也强制刷新页面
      window.location.href = '/?logout_error=true'
    }
  }

  // 智能导航栏滚动效果
  useEffect(() => {
    if (!mounted) return

    const handleScroll = () => {
      const currentScrollY = window.scrollY
      const lastScrollY = lastScrollYRef.current

      // 更新滚动状态（用于视觉效果）
      setIsScrolled(currentScrollY > 50)

      // 在页面顶部时始终显示导航栏
      if (currentScrollY < 10) {
        setIsNavVisible(true)
      }
      // 向下滚动且超过500px时隐藏导航栏
      else if (currentScrollY > lastScrollY && currentScrollY > 500) {
        setIsNavVisible(false)
        setIsMobileMenuOpen(false) // 隐藏时关闭移动端菜单
      }
      // 向上滚动时显示导航栏
      else if (currentScrollY < lastScrollY) {
        setIsNavVisible(true)
      }

      lastScrollYRef.current = currentScrollY
    }

    // 添加节流优化，避免过度触发
    let ticking = false
    const throttledHandleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleScroll()
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener('scroll', throttledHandleScroll, { passive: true })
    return () => window.removeEventListener('scroll', throttledHandleScroll)
  }, [mounted])

  if (!mounted) {
    // 返回一个占位符，避免水合不匹配
    return (
      <header className="fixed top-4 left-4 right-4 z-40 max-w-6xl mx-auto transition-transform duration-300 ease-in-out translate-y-0">
        <div className="bg-black/20 backdrop-blur-lg border border-white/10 rounded-2xl px-6 h-16 flex items-center justify-between shadow-lg">
          <div className="w-full h-6 bg-gray-800/50 animate-pulse rounded"></div>
        </div>
      </header>
    )
  }

  return (
    <header className={cn(
      "fixed top-4 left-4 right-4 z-40 max-w-6xl mx-auto transition-transform duration-300 ease-in-out",
      isNavVisible ? "translate-y-0" : "-translate-y-full"
    )}>
      <div className={cn(
        "bg-black/20 backdrop-blur-lg border border-white/10 rounded-2xl px-6 shadow-lg transition-all duration-300",
        isScrolled && "bg-black/30 shadow-2xl"
      )}>
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center">
            <Link href="/" className="text-xl font-bold text-lime-400 mr-8">
              论坛
            </Link>

            {/* 桌面导航 */}
            <nav className="hidden md:flex space-x-2 items-center">
              <Link
                href="/"
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200",
                  pathname === "/"
                    ? "bg-lime-400/20 text-lime-400 shadow-lg"
                    : "text-gray-300 hover:text-lime-400 hover:bg-white/10",
                )}
              >
                首页
              </Link>

              {/* 分类下拉菜单 */}
              <CategoryMenu activeCategory={activeCategory} />

              {/* 弹幕墙入口 */}
              <Link
                href="/live"
                title="弹幕墙"
                className={cn(
                  "flex items-center justify-center h-9 w-9 rounded-xl transition-all duration-200",
                  pathname === "/live"
                    ? "bg-pink-400/20 text-pink-300 shadow-lg"
                    : "text-gray-300 hover:text-pink-300 hover:bg-white/10",
                )}
              >
                <Zap className="h-4 w-4" />
              </Link>

              {/* 影院模式切换 */}
              <button
                onClick={toggleCinemaMode}
                title={cinemaMode ? "退出影院模式" : "影院模式"}
                className={cn(
                  "flex items-center justify-center h-9 w-9 rounded-xl transition-all duration-200",
                  cinemaMode
                    ? "bg-pink-400/20 text-pink-400 shadow-lg"
                    : "text-gray-300 hover:text-pink-400 hover:bg-white/10",
                )}
              >
                <Clapperboard className="h-4 w-4" />
              </button>

              {/* 音乐 */}
              <Link
                href="/music"
                title="音乐"
                className={cn(
                  "flex items-center justify-center h-9 w-9 rounded-xl transition-all duration-200",
                  pathname === "/music"
                    ? "bg-pink-400/20 text-pink-300 shadow-lg"
                    : "text-gray-300 hover:text-pink-300 hover:bg-white/10",
                )}
              >
                <Music className="h-4 w-4" />
              </Link>

              {isAdmin && (
                <Link
                  href="/admin"
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200",
                    pathname === "/admin"
                      ? "bg-lime-400/20 text-lime-400 shadow-lg"
                      : "text-gray-300 hover:text-lime-400 hover:bg-white/10",
                  )}
                >
                  管理
                </Link>
              )}
              {user && (
                <Link
                  href="/profile"
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200",
                    pathname === "/profile"
                      ? "bg-lime-400/20 text-lime-400 shadow-lg"
                      : "text-gray-300 hover:text-lime-400 hover:bg-white/10",
                  )}
                >
                  个人中心
                </Link>
              )}
            </nav>
          </div>

          <div className="flex items-center">
            {user ? (
              <>
                <NotificationBell />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-10 w-10 rounded-full p-0">
                      <Avatar className="h-9 w-9 avatar-breathe cursor-pointer">
                        <AvatarImage src={avatarUrl || undefined} alt="用户头像" />
                        <AvatarFallback className="bg-lime-900/30 text-lime-400 text-sm">
                          {user.user_metadata?.username?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || "U"}
                        </AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none text-lime-400">
                          {user.user_metadata?.username || "用户"}
                          {isAdmin && <span className="ml-2 text-xs bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded border border-red-500/30">管理员</span>}
                        </p>
                        <p className="text-xs leading-none text-white/50">{user.email}</p>
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild className="hover:text-lime-400">
                      <Link href="/profile">
                        <User className="mr-2 h-4 w-4" />
                        <span>个人中心</span>
                      </Link>
                    </DropdownMenuItem>
                    {isAdmin && (
                      <DropdownMenuItem asChild className="hover:text-lime-400">
                        <Link href="/admin">
                          <Settings className="mr-2 h-4 w-4" />
                          <span>管理面板</span>
                        </Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-red-400 hover:text-red-300"
                      onClick={handleSignOut}
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>退出登录</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <div className="hidden md:flex space-x-3">
                <Button asChild variant="ghost" className="text-gray-300 hover:text-lime-400 hover:bg-white/10 rounded-xl transition-all duration-200">
                  <Link href="/login">登录</Link>
                </Button>
                <Button asChild variant="outline" className="border-lime-400/50 text-lime-400 hover:bg-lime-400/20 hover:border-lime-400 rounded-xl shadow-lg transition-all duration-200">
                  <Link href="/register">注册</Link>
                </Button>
              </div>
            )}

            {/* 移动端菜单按钮 */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden ml-2"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* 移动端菜单 */}
      {isMobileMenuOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 md:hidden">
          <div className="bg-black/30 backdrop-blur-lg border border-white/10 rounded-2xl mx-0 shadow-lg">
            <div className="px-6 py-4">
              <nav className="flex flex-col space-y-2">
                <Link
                  href="/"
                  className={cn(
                    "px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200",
                    pathname === "/"
                      ? "bg-lime-400/20 text-lime-400 shadow-lg"
                      : "text-gray-300 hover:text-lime-400 hover:bg-white/10",
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  首页
                </Link>

                {/* 分类（移动端） */}
                <div className="px-1">
                  <CategoryMenu activeCategory={activeCategory} compact />
                </div>

                {/* 弹幕墙（移动端） */}
                <Link
                  href="/live"
                  className={cn(
                    "flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200",
                    pathname === "/live"
                      ? "bg-pink-400/20 text-pink-300 shadow-lg"
                      : "text-gray-300 hover:text-pink-300 hover:bg-white/10",
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <Zap className="mr-2 h-4 w-4" />
                  弹幕墙
                </Link>

                {/* 影院模式（移动端） — 复用桌面端的 toggleCinemaMode：
                    不在首页则跳 /?cinema=1，在首页则切换 context */}
                <button
                  type="button"
                  onClick={() => {
                    toggleCinemaMode()
                    setIsMobileMenuOpen(false)
                  }}
                  className={cn(
                    "flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200 text-left",
                    cinemaMode
                      ? "bg-pink-400/20 text-pink-400 shadow-lg"
                      : "text-gray-300 hover:text-pink-400 hover:bg-white/10",
                  )}
                >
                  <Clapperboard className="mr-2 h-4 w-4" />
                  {cinemaMode ? "退出影院模式" : "影院模式"}
                </button>

                {/* 音乐（移动端） */}
                <Link
                  href="/music"
                  className={cn(
                    "flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200",
                    pathname === "/music"
                      ? "bg-pink-400/20 text-pink-300 shadow-lg"
                      : "text-gray-300 hover:text-pink-300 hover:bg-white/10",
                  )}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <Music className="mr-2 h-4 w-4" />
                  音乐
                </Link>

                {isAdmin && (
                  <Link
                    href="/admin"
                    className={cn(
                      "px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200",
                      pathname === "/admin"
                        ? "bg-lime-400/20 text-lime-400 shadow-lg"
                        : "text-gray-300 hover:text-lime-400 hover:bg-white/10",
                    )}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    管理
                  </Link>
                )}
                {user && (
                  <Link
                    href="/profile"
                    className={cn(
                      "px-4 py-3 text-sm font-medium rounded-xl transition-all duration-200",
                      pathname === "/profile"
                        ? "bg-lime-400/20 text-lime-400 shadow-lg"
                        : "text-gray-300 hover:text-lime-400 hover:bg-white/10",
                    )}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    个人中心
                  </Link>
                )}
                
                {!user && (
                  <>
                    <Link
                      href="/login"
                      className="px-4 py-3 text-sm font-medium rounded-xl text-gray-300 hover:text-lime-400 hover:bg-white/10 transition-all duration-200"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      登录
                    </Link>
                    <Link
                      href="/register"
                      className="px-4 py-3 text-sm font-medium rounded-xl text-lime-400 bg-lime-400/20 hover:bg-lime-400/30 shadow-lg transition-all duration-200"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      注册
                    </Link>
                  </>
                )}
              </nav>
            </div>
          </div>
        </div>
      )}
    </header>
  )
} 