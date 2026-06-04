"use client"

import { Suspense, useEffect, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { AnimatePresence } from "framer-motion"
import PostGrid from "@/components/post-grid"
import CinemaMode from "@/components/cinema-mode"
import FloatingActionButton from "@/components/floating-action-button"
import { usePosts } from "@/contexts/posts-context"
import { useCinemaMode } from "@/contexts/cinema-mode-context"
import { isValidCategory, CATEGORY_LABELS } from "@/lib/categories"
import { motion } from "framer-motion"

// HomePage 内部使用了 useSearchParams()，在 Next.js `output:'export'`
// 静态构建（Capacitor APK）模式下必须包 Suspense，否则 build 阶段 prerender 失败。
function HomeContent() {
  const { setCategory, state } = usePosts()
  const searchParams = useSearchParams()
  // 影院模式状态由 CinemaModeProvider 统一管理（localStorage / URL ?cinema=1 也在那里）
  const { cinemaMode } = useCinemaMode()

  // 从 URL 读 ?category=xxx，useSearchParams 在 URL 变化时自动重渲
  const activeCategory = useMemo(() => {
    const raw = searchParams?.get("category") || null
    return isValidCategory(raw) ? raw : null
  }, [searchParams])

  // 同步分类到 PostsContext
  useEffect(() => {
    if (activeCategory !== state.category) {
      setCategory(activeCategory)
    }
  }, [activeCategory, state.category, setCategory])

  // 百叶窗效果样式
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
    backdropFilter: 'blur(0.7px)',
  }

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
            className="container mx-auto px-4 pt-24 pb-8 max-w-7xl z-10 relative"
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

            {/* 帖子列表 */}
            <motion.section
              className="mb-8"
              initial={{ opacity: 0, y: 30 }}
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
