"use client"

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { LogOut, User, Settings, Menu, X, PlusCircle, Home, Layers, LogIn, UserPlus, ChevronDown } from "lucide-react"
import Link from "next/link"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
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
import { isValidCategory, CATEGORIES } from "@/lib/categories"
import { Clapperboard, Zap, Music } from "lucide-react"

// Navigation 内用 useSearchParams 读 ?category=xxx 高亮分类；
// output:'export' 静态构建下必须包 Suspense（见底部 default export）。
function NavigationContent() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, signOut, isAdmin } = useSimpleAuth()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  // 分类卡片在浮层内展开二级分类
  const [catExpanded, setCatExpanded] = useState(false)
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

  // 关闭移动端浮层菜单（同时收起二级分类）
  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false)
    setCatExpanded(false)
  }

  // 选择分类：更新 URL query 后关闭菜单（逻辑与桌面端 CategoryMenu 保持一致）
  const selectCategory = (value: string | null) => {
    const url = new URL(window.location.href)
    if (value) url.searchParams.set("category", value)
    else url.searchParams.delete("category")
    router.push(`/${url.search}${url.hash}`)
    closeMobileMenu()
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

  // 移动端浮层菜单的卡片配置（galgame 卡片网格）。
  // 绿卡=站内导航，粉卡=ACG 功能（弹幕墙/影院/音乐）。
  const actionCards: {
    key: string
    icon: ReactNode
    zh: string
    en: string
    tone: "lime" | "pink"
    active: boolean
    onClick: () => void
  }[] = [
    { key: "home", icon: <Home className="h-5 w-5" />, zh: "首页", en: "HOME", tone: "lime", active: pathname === "/", onClick: () => { router.push("/"); closeMobileMenu() } },
    { key: "live", icon: <Zap className="h-5 w-5" />, zh: "弹幕墙", en: "DANMAKU", tone: "pink", active: pathname === "/live", onClick: () => { router.push("/live"); closeMobileMenu() } },
    { key: "cinema", icon: <Clapperboard className="h-5 w-5" />, zh: cinemaMode ? "退出影院" : "影院模式", en: "CINEMA", tone: "pink", active: cinemaMode, onClick: () => { toggleCinemaMode(); closeMobileMenu() } },
    { key: "music", icon: <Music className="h-5 w-5" />, zh: "音乐", en: "MUSIC", tone: "pink", active: pathname === "/music", onClick: () => { router.push("/music"); closeMobileMenu() } },
  ]
  if (user) {
    actionCards.push({ key: "profile", icon: <User className="h-5 w-5" />, zh: "个人中心", en: "PROFILE", tone: "lime", active: pathname === "/profile", onClick: () => { router.push("/profile"); closeMobileMenu() } })
  }
  if (isAdmin) {
    actionCards.push({ key: "admin", icon: <Settings className="h-5 w-5" />, zh: "管理", en: "ADMIN", tone: "lime", active: pathname === "/admin", onClick: () => { router.push("/admin"); closeMobileMenu() } })
  }
  if (!user) {
    actionCards.push({ key: "login", icon: <LogIn className="h-5 w-5" />, zh: "登录", en: "LOGIN", tone: "lime", active: false, onClick: () => { router.push("/login"); closeMobileMenu() } })
    actionCards.push({ key: "register", icon: <UserPlus className="h-5 w-5" />, zh: "注册", en: "REGISTER", tone: "lime", active: false, onClick: () => { router.push("/register"); closeMobileMenu() } })
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
              onClick={() => (isMobileMenuOpen ? closeMobileMenu() : setIsMobileMenuOpen(true))}
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>

      {/* 移动端菜单：全屏居中霓虹卡片浮层（galgame CG 鉴赏室风格）。
          通过 portal 渲染到 body，避免被导航栏 backdrop-filter 祖先容器限制采样范围。
          只有 scrim 做背景模糊，卡片自身不再叠加 backdrop-filter，降低低端机渲染压力。 */}
      {createPortal(
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              className="fixed inset-0 z-[55] md:hidden"
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              {/* 暗化 + 模糊背景，点击关闭。纯 CSS 淡入，退场随整体淡出。 */}
              <div
                className="menu-scrim-in absolute inset-0 bg-black/55 backdrop-blur-md"
                onClick={closeMobileMenu}
              />

              {/* 居中卡片面板：可滚动容器，点空白处（容器本身）关闭；内容用 m-auto 居中，
                  内容超高时也能滚动、顶部不会被 flex 裁切。 */}
              <div
                className="absolute inset-0 flex overflow-y-auto px-5 py-16"
                onClick={(e) => {
                  if (e.target === e.currentTarget) closeMobileMenu()
                }}
              >
                <div className="m-auto w-full">
                <div className="menu-title-in mb-5 text-center text-[11px] tracking-[0.4em] text-white/40">
                  夜幕渐暗 · 萤火微光
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {actionCards.map((c, i) => (
                    <MenuCard
                      key={c.key}
                      icon={c.icon}
                      zh={c.zh}
                      en={c.en}
                      tone={c.tone}
                      active={c.active}
                      // 数量为奇数时最后一张横跨整行，避免末尾落单留白
                      wide={actionCards.length % 2 === 1 && i === actionCards.length - 1}
                      delay={0.08 + i * 0.05}
                      onClick={c.onClick}
                    />
                  ))}

                  {/* 分类：整行宽卡，点开在下方内联展开二级分类 */}
                  <MenuCard
                    icon={<Layers className="h-5 w-5" />}
                    zh="分类"
                    en="CATEGORY"
                    tone="lime"
                    active={!!activeCategory}
                    wide
                    showChevron
                    chevronOpen={catExpanded}
                    delay={0.08 + actionCards.length * 0.05}
                    onClick={() => setCatExpanded((v) => !v)}
                  />

                  <AnimatePresence initial={false}>
                    {catExpanded && (
                      <motion.div
                        className="pointer-events-auto col-span-2 overflow-hidden"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.28, ease: [0.22, 0.7, 0.18, 1] }}
                      >
                        <div className="grid grid-cols-4 gap-2 pt-1">
                          <CatChip glyph="✱" label="全部" active={!activeCategory} onClick={() => selectCategory(null)} />
                          {CATEGORIES.map((cat) => (
                            <CatChip
                              key={cat.value}
                              glyph={cat.glyph}
                              label={cat.label}
                              active={activeCategory === cat.value}
                              onClick={() => selectCategory(cat.value)}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                </div>
              </div>

              {/* 关闭按钮：放在面板容器之后，确保始终在最上层可点 */}
              <button
                onClick={closeMobileMenu}
                aria-label="关闭菜单"
                className="menu-scrim-in absolute top-6 right-6 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/70 transition-transform active:scale-90"
              >
                <X className="h-5 w-5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </header>
  )
}

function MenuCard({
  icon,
  zh,
  en,
  tone,
  active,
  wide = false,
  showChevron = false,
  chevronOpen = false,
  delay = 0,
  onClick,
}: {
  icon: ReactNode
  zh: string
  en: string
  tone: "lime" | "pink"
  active: boolean
  wide?: boolean
  showChevron?: boolean
  chevronOpen?: boolean
  delay?: number
  onClick: () => void
}) {
  // 外层 wrapper 负责入场动画（纯 CSS transform/opacity，走合成器、丝滑）；
  // 内层 button 负责样式与按下缩放。二者分离，避免 animation 的 fill 值覆盖 :active 的 transform。
  return (
    <div className={cn("menu-card-pop", wide && "col-span-2")} style={{ animationDelay: `${delay}s` }}>
      <button
        onClick={onClick}
        className={cn(
          "relative flex h-full min-h-[100px] w-full flex-col gap-2 overflow-hidden rounded-2xl border p-4 text-left transition-transform active:scale-[0.97]",
          wide && "min-h-0 flex-row items-center gap-3",
          active
            ? tone === "pink"
              ? "border-pink-400/50 bg-pink-400/[0.08] shadow-[0_0_30px_rgba(244,114,182,0.18)]"
              : "border-lime-400/50 bg-lime-400/[0.08] shadow-[0_0_30px_rgba(163,230,53,0.18)]"
            : "border-white/10 bg-white/[0.05]",
        )}
      >
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center",
            tone === "pink" ? (active ? "text-pink-400" : "text-pink-300") : "text-lime-400",
          )}
        >
          {icon}
        </span>
        <div className={cn("flex flex-col", wide ? "flex-1" : "mt-auto")}>
          <span
            className={cn(
              "text-base font-semibold",
              active ? (tone === "pink" ? "text-pink-300" : "text-lime-400") : "text-white/90",
            )}
          >
            {zh}
          </span>
          <span className="text-[9px] tracking-[0.22em] text-white/40">{en}</span>
        </div>
        {showChevron && (
          <ChevronDown
            className={cn("h-4 w-4 text-white/50 transition-transform duration-200", chevronOpen && "rotate-180")}
          />
        )}
      </button>
    </div>
  )
}

function CatChip({
  glyph,
  label,
  active,
  onClick,
}: {
  glyph: string
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "pointer-events-auto flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 transition-colors active:scale-95",
        active ? "border-lime-400/40 bg-lime-400/[0.12] text-lime-400" : "border-white/10 bg-white/[0.04] text-white/70",
      )}
    >
      <span className="text-sm">{glyph}</span>
      <span className="text-[11px]">{label}</span>
    </button>
  )
}

export default function Navigation() {
  return (
    <Suspense fallback={null}>
      <NavigationContent />
    </Suspense>
  )
}
