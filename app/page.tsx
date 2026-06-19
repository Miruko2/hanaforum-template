"use client"

import { Suspense, useEffect, useMemo, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { AnimatePresence } from "framer-motion"
import PostGrid from "@/components/post-grid"
import CinemaMode from "@/components/cinema-mode"
import FloatingActionButton from "@/components/floating-action-button"
import { usePosts, type PostSortMode } from "@/contexts/posts-context"
import { useCinemaMode } from "@/contexts/cinema-mode-context"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { isValidCategory, CATEGORY_LABELS } from "@/lib/categories"
import { motion } from "framer-motion"
import { UserCheck } from "lucide-react"

// 首页是否已进入过一次（模块级，跨路由往返保留）。
// 帖子数据由全局 PostsProvider 缓存，从 music 等页返回首页时内容其实是「现成的」，
// 真正让人觉得「加载慢」的是每次都重放一遍 0.5s 上滑入场动画。
// 故首次进入保留完整入场动画，之后的返回直接秒显内容（入场动画跳过），
// 配合导航的丝带转场，回首页是「转场揭开即见内容」而非空等动画。
let homeEntered = false

// 百叶窗效果样式（静态对象提升到模块级，避免每次渲染重建）
const blindsOverlayStyle = {
  position: 'fixed' as const,
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  backgroundImage: `repeating-linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.15),
    rgba(0, 0, 0, 0.15) 2px,
    rgba(0, 0, 0, 0.03) 2px,
    rgba(0, 0, 0, 0.03) 4px
  )`,
  pointerEvents: 'none' as const,
  zIndex: 0,
}

const SORT_OPTIONS: { value: PostSortMode; label: string }[] = [
  { value: "default", label: "默认" },
  { value: "hot", label: "热度" },
]

// 「关注」仅登录用户可见：未登录没关注列表，显示也无意义。
// 用 getSortOptions(isLoggedIn) 在登录时追加第三项，pill 滑块 / 切换逻辑零改动复用。
const FOLLOWING_OPTION = { value: "following" as PostSortMode, label: "关注" }
const getSortOptions = (isLoggedIn: boolean) =>
  isLoggedIn ? [...SORT_OPTIONS, FOLLOWING_OPTION] : SORT_OPTIONS

// HomePage 内部使用了 useSearchParams()，在 Next.js `output:'export'`
// 静态构建（Capacitor APK）模式下必须包 Suspense，否则 build 阶段 prerender 失败。
function HomeContent() {
  const { setCategory, setSort, state } = usePosts()
  const searchParams = useSearchParams()
  // 影院模式状态由 CinemaModeProvider 统一管理（localStorage / URL ?cinema=1 也在那里）
  const { cinemaMode } = useCinemaMode()
  // 登录态决定「关注」选项是否出现
  const { user } = useSimpleAuth()
  const isLoggedIn = !!user

  // 帖子排序方式由 PostsContext 管理：default=按时间，hot=按赞/评论权重（数据库端排序），
  // following=只看关注者的帖（需登录，数据库端 JOIN follows+posts）
  const sortMode = state.sort
  const sortOptions = getSortOptions(isLoggedIn)

  // 从 URL 读 ?category=xxx，useSearchParams 在 URL 变化时自动重渲
  const activeCategory = useMemo(() => {
    const raw = searchParams?.get("category") || null
    return isValidCategory(raw) ? raw : null
  }, [searchParams])

  // 首次进入才播放入场动画；之后的路由返回直接秒显（见 homeEntered 注释）。
  const firstEnter = useRef(!homeEntered)
  useEffect(() => {
    homeEntered = true
  }, [])

  // 同步分类到 PostsContext
  useEffect(() => {
    if (activeCategory !== state.category) {
      setCategory(activeCategory)
    }
  }, [activeCategory, state.category, setCategory])

  return (
    <div className="min-h-screen relative">
      {/* 百叶窗效果 */}
      <div style={blindsOverlayStyle}></div>

      <AnimatePresence mode="wait">
        {cinemaMode ? (
          <motion.div
            key="cinema"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="relative z-10 pt-24"
          >
            <CinemaMode posts={state.posts} />
          </motion.div>
        ) : (
          <motion.main
            key="grid"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="container mx-auto px-4 pt-24 pb-8 max-w-[2200px] z-10 relative"
          >
            {/* 当前分类提示（仅过滤时显示） */}
            {activeCategory && (
              <motion.div
                className="mb-6 flex items-center gap-3 text-white/80"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                key={activeCategory}
              >
                <div
                  className="h-8 w-1 bg-lime-400 rounded-full"
                  style={{ boxShadow: "0 0 16px rgba(132,204,22,0.5)" }}
                />
                <span className="text-sm tracking-widest uppercase text-white/50">分类</span>
                <span className="text-xl font-semibold">
                  {CATEGORY_LABELS[activeCategory] || activeCategory}
                </span>
              </motion.div>
            )}

            {/* 排序切换：默认（按时间）/ 热度（按权重）/ 关注（仅登录，只看关注者的帖） */}
            <motion.div
              className="mb-5 flex items-center gap-1 px-4 max-w-[2200px] mx-auto"
              initial={firstEnter.current ? { opacity: 0, y: -8 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              {sortOptions.map(({ value, label }) => {
                const active = sortMode === value
                return (
                  <button
                    key={value}
                    onClick={() => setSort(value)}
                    className={`relative px-4 py-1.5 text-sm rounded-full transition-colors duration-200 inline-flex items-center gap-1.5 ${
                      active ? "text-black font-semibold" : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="sort-pill"
                        className="absolute inset-0 bg-lime-400 rounded-full"
                        style={{ boxShadow: "0 0 16px rgba(132,204,22,0.45)" }}
                        transition={{ type: "spring", stiffness: 500, damping: 35 }}
                      />
                    )}
                    {value === "following" && (
                      <UserCheck className="relative z-10 h-3.5 w-3.5" />
                    )}
                    <span className="relative z-10">{label}</span>
                  </button>
                )
              })}
            </motion.div>

            {/* 帖子列表 */}
            <motion.section
              className="mb-8"
              initial={firstEnter.current ? { opacity: 0, y: 30 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <PostGrid />
            </motion.section>
          </motion.main>
        )}
      </AnimatePresence>

      <FloatingActionButton />
    </div>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  )
}
