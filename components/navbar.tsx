"use client"

import { useState, useEffect, useRef } from "react"
import { cdnUrl } from "@/lib/cdn-url"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { LogOut, User, Settings, Menu, X } from "lucide-react"
import AppLink from "@/components/app-link"
import { navigateTo } from "@/lib/app-navigation"
import { supabase } from "@/lib/supabaseClient"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export default function Navbar() {
  const pathname = usePathname()
  const { user, signOut, isAdmin } = useSimpleAuth()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isNavVisible, setIsNavVisible] = useState(true)
  // lastScrollY 只在滚动 handler 内做比较，不参与渲染，用 ref 避免 set 触发
  // useEffect 重新绑/解绑 scroll 监听器（之前每帧重绑一次）
  const lastScrollYRef = useRef(0)
  const [isScrolled, setIsScrolled] = useState(false)
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
          console.error('Navbar: 获取头像异常:', err)
        }
        setAvatarUrl(null)
      }
    }

    fetchAvatar()
  }, [user?.id])

  // 处理导航方法
  const handleNavigation = (path: string) => {
    setIsMobileMenuOpen(false)
    navigateTo(path)
  }

  // 处理登出
  const handleSignOut = async () => {
    await signOut()
    // 登出后导航到首页
    navigateTo('/', { delay: 300 })
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
            <AppLink href="/" className="text-xl font-bold text-lime-400 mr-8">
              萤火虫之国
            </AppLink>

            {/* 桌面导航 */}
            <nav className="hidden md:flex space-x-2">
              <AppLink
                href="/"
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200",
                  pathname === "/"
                    ? "bg-lime-400/20 text-lime-400 shadow-lg"
                    : "text-gray-300 hover:text-lime-400 hover:bg-white/10",
                )}
              >
                首页
              </AppLink>
              {isAdmin && (
                <AppLink
                  href="/admin"
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200",
                    pathname === "/admin"
                      ? "bg-lime-400/20 text-lime-400 shadow-lg"
                      : "text-gray-300 hover:text-lime-400 hover:bg-white/10",
                  )}
                >
                  管理
                </AppLink>
              )}
              <AppLink
                href="/profile"
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200",
                  pathname === "/profile"
                    ? "bg-lime-400/20 text-lime-400 shadow-lg"
                    : "text-gray-300 hover:text-lime-400 hover:bg-white/10",
                )}
              >
                个人中心
              </AppLink>
            </nav>
          </div>

          <div className="flex items-center">
            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    {avatarUrl ? (
                      <img
                        src={cdnUrl(avatarUrl) ?? undefined}
                        alt="用户头像"
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center rounded-full bg-lime-900/30 text-lime-400">
                        {user.user_metadata?.username?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || "U"}
                      </div>
                    )}
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
                  <DropdownMenuItem
                    className="hover:text-lime-400"
                    onClick={() => handleNavigation('/profile')}
                  >
                    <User className="mr-2 h-4 w-4" />
                    <span>个人中心</span>
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem
                      className="hover:text-lime-400"
                      onClick={() => handleNavigation('/admin')}
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      <span>管理面板</span>
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
            ) : (
              <div className="hidden md:flex space-x-3">
                <Button asChild variant="ghost" className="text-gray-300 hover:text-lime-400 hover:bg-white/10 rounded-xl transition-all duration-200">
                  <AppLink href="/login">登录</AppLink>
                </Button>
                <Button asChild variant="outline" className="border-lime-400/50 text-lime-400 hover:bg-lime-400/20 hover:border-lime-400 rounded-xl shadow-lg transition-all duration-200">
                  <AppLink href="/register">注册</AppLink>
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
                <AppLink
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
                </AppLink>
                {isAdmin && (
                  <AppLink
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
                  </AppLink>
                )}
                <AppLink
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
                </AppLink>
                
                {!user && (
                  <>
                    <AppLink
                      href="/login"
                      className="px-4 py-3 text-sm font-medium rounded-xl text-gray-300 hover:text-lime-400 hover:bg-white/10 transition-all duration-200"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      登录
                    </AppLink>
                    <AppLink
                      href="/register"
                      className="px-4 py-3 text-sm font-medium rounded-xl text-lime-400 bg-lime-400/20 hover:bg-lime-400/30 shadow-lg transition-all duration-200"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      注册
                    </AppLink>
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
