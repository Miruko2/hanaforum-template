"use client"

import { Suspense, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react"
import { cdnUrl } from "@/lib/cdn-url"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { LogOut, User, Settings, Menu, X, PlusCircle, Home, Layers, LogIn, UserPlus, ChevronDown, MessageCircle } from "lucide-react"
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
import { useChatUI } from "@/contexts/chat-ui-context"
import { isValidCategory, CATEGORIES } from "@/lib/categories"
import {
  CINEMA_RING_PATH,
  effectiveRingPath,
  navigateWithTransition,
  ringDirection,
} from "@/lib/view-transition-nav"
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
  const [isScrolled, setIsScrolled] = useState(false)
  // 首页下滑收起导航栏、上滑出现；其他页面常驻
  const [navHidden, setNavHidden] = useState(false)
  // 当前激活的分类（仅用于 CategoryMenu 的高亮态）— useSearchParams 自动跟随 URL
  const activeCategory = useMemo(() => {
    const raw = searchParams?.get("category") || null
    return isValidCategory(raw) ? raw : null
  }, [searchParams])
  // 影院模式由 CinemaModeProvider 统一管理（替代之前的 CustomEvent 总线）
  const { cinemaMode } = useCinemaMode()
  // 聊天室入口：读未读数显示红点、点击打开面板（与 floating-chat 共享状态）
  const { setOpen: setChatOpen, unread: chatUnread } = useChatUI()
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

  // 是否正处于影院视图（影院状态只在首页生效）
  const inCinema = cinemaMode && pathname === "/"

  // 主导航（首页/弹幕墙/影院/音乐/个人中心）之间的跳转走标题卡遮罩转场，
  // 方向按导航序判定；环外路径（管理/登录等）退化为普通 push。
  // 当前在首页 + 影院开 = 处在虚拟影院环位，方向以它为起点算。
  const flipNav = (href: string) => {
    const dir = ringDirection(effectiveRingPath(pathname || "", cinemaMode), href)
    if (dir) navigateWithTransition(router, href, dir)
    // 虚拟影院位没有真实路由，普通 push 兜底走 ?cinema=1 深链
    else router.push(href === CINEMA_RING_PATH ? "/?cinema=1" : href)
  }

  // 桌面 Link 点击改走翻页转场；保留 href 以支持中键/新标签/SEO
  const handleFlipLink = (e: MouseEvent, href: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    flipNav(href)
  }

  // 切换影院模式：和滑动切页一样走带方向的遮罩转场
  // （进影院 = 去虚拟影院环位，退影院 = 回首页环位）
  const toggleCinemaMode = () => {
    flipNav(inCinema ? "/" : CINEMA_RING_PATH)
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

    // 切页时先恢复可见，避免上一页隐藏状态带到新页
    setNavHidden(false)
    let lastY = window.scrollY

    const handleScroll = () => {
      const y = window.scrollY
      // 视觉状态：滚动一定距离后背景加深
      setIsScrolled(y > 50)
      // 仅首页：下滑收起、上滑出现（带 6px 抖动死区）；其他页面常驻
      if (pathname === "/") {
        const dy = y - lastY
        if (y < 80) setNavHidden(false)
        else if (dy > 6) setNavHidden(true)
        else if (dy < -6) setNavHidden(false)
      } else {
        setNavHidden(false)
      }
      lastY = y
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
  }, [mounted, pathname])

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
    { key: "home", icon: <Home className="h-5 w-5" />, zh: "首页", en: "HOME", tone: "lime", active: pathname === "/" && !inCinema, onClick: () => { flipNav("/"); closeMobileMenu() } },
    { key: "live", icon: <Zap className="h-5 w-5" />, zh: "弹幕墙", en: "DANMAKU", tone: "pink", active: pathname === "/live", onClick: () => { flipNav("/live"); closeMobileMenu() } },
    { key: "cinema", icon: <Clapperboard className="h-5 w-5" />, zh: inCinema ? "退出影院" : "影院模式", en: "CINEMA", tone: "pink", active: inCinema, onClick: () => { toggleCinemaMode(); closeMobileMenu() } },
    { key: "music", icon: <Music className="h-5 w-5" />, zh: "音乐", en: "MUSIC", tone: "pink", active: pathname === "/music", onClick: () => { flipNav("/music"); closeMobileMenu() } },
  ]
  if (user) {
    actionCards.push({ key: "profile", icon: <User className="h-5 w-5" />, zh: "个人中心", en: "PROFILE", tone: "lime", active: pathname === "/profile", onClick: () => { flipNav("/profile"); closeMobileMenu() } })
  }
  if (isAdmin) {
    actionCards.push({ key: "admin", icon: <Settings className="h-5 w-5" />, zh: "管理", en: "ADMIN", tone: "lime", active: pathname === "/admin", onClick: () => { router.push("/admin"); closeMobileMenu() } })
  }
  if (!user) {
    actionCards.push({ key: "login", icon: <LogIn className="h-5 w-5" />, zh: "登录", en: "LOGIN", tone: "lime", active: false, onClick: () => { router.push("/login"); closeMobileMenu() } })
    actionCards.push({ key: "register", icon: <UserPlus className="h-5 w-5" />, zh: "注册", en: "REGISTER", tone: "lime", active: false, onClick: () => { router.push("/register"); closeMobileMenu() } })
  }

  return (
    // 注意：这里不能加 view-transition-name —— 它会让 header 变成 backdrop root，
    // 内部 backdrop-blur 采不到页面背景、毛玻璃失效。转场时导航栏随整面墙一起翻。
    <header className={cn(
      "fixed top-4 left-4 right-4 z-40 max-w-6xl mx-auto transition-transform duration-300 ease-in-out",
      navHidden ? "-translate-y-[150%]" : "translate-y-0"
    )}>
      <div className={cn(
        "bg-black/20 backdrop-blur-lg border border-white/10 rounded-2xl px-6 shadow-lg transition-all duration-300",
        isScrolled && "bg-black/30 shadow-2xl"
      )}>
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center">
            <Link href="/" onClick={(e) => handleFlipLink(e, "/")} className="text-xl font-bold text-lime-400 mr-8">
              论坛
            </Link>

            {/* 桌面导航 */}
            <nav className="hidden md:flex space-x-2 items-center">
              <Link
                href="/"
                onClick={(e) => handleFlipLink(e, "/")}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200",
                  pathname === "/" && !inCinema
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
                onClick={(e) => handleFlipLink(e, "/live")}
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
                title={inCinema ? "退出影院模式" : "影院模式"}
                className={cn(
                  "flex items-center justify-center h-9 w-9 rounded-xl transition-all duration-200",
                  inCinema
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
                onClick={(e) => handleFlipLink(e, "/music")}
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
                  onClick={(e) => handleFlipLink(e, "/profile")}
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
                {/* 聊天室入口：与通知铃并列，带未读红点；全站常驻 */}
                <button
                  onClick={() => setChatOpen(true)}
                  className="relative flex h-10 w-10 items-center justify-center rounded-full text-gray-300 transition-colors hover:bg-white/10 hover:text-pink-300"
                  aria-label="聊天室"
                  title="聊天室"
                >
                  <MessageCircle className="h-5 w-5" />
                  {chatUnread > 0 && (
                    <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-pink-300/70 px-1 text-[10px] font-bold leading-none text-white shadow">
                      {chatUnread > 99 ? "99+" : chatUnread}
                    </span>
                  )}
                </button>
                <NotificationBell />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-10 w-10 rounded-full p-0">
                      <Avatar className="h-9 w-9 avatar-breathe cursor-pointer">
                        <AvatarImage src={cdnUrl(avatarUrl) || undefined} alt="用户头像" />
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
