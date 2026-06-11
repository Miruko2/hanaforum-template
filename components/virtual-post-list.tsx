"use client"

import { useEffect, useRef, useCallback, useState, memo } from "react"
import Masonry from "react-masonry-css"
import { useInView } from "react-intersection-observer"
import PostCard from "./post-card"
import { PulseLoading } from "./ui/loading-animation"
import type { Post } from "@/lib/types"

interface VirtualPostListProps {
  posts: Post[]
  loadMorePosts?: (page: number, limit: number) => Promise<void>
  hasMore?: boolean
  loading?: boolean
  activePostId?: string | null
  onPostClick?: (postId: string) => void
  onPostClose?: () => void
  onPostUpdated?: (postId: string, updates: Partial<Post>) => void
  onPostDeleted?: (postId: string) => void
  pageSize?: number
}

// 响应式列数配置：key 是最大视口宽度，value 是列数
// "default" 是超出最大断点时的默认列数
// 注意：仅调整列数，不动瀑布流 (react-masonry-css) 的结构/样式
const breakpointColumns = {
  default: 5, // >= 1920：PC 5 列
  1919: 5,    // 1536 - 1919：PC 5 列
  1535: 5,    // 1280 - 1535：PC 5 列（小屏笔记本，卡片会比较窄）
  1279: 3,    // 768 - 1279：平板 (iPad 竖/横屏、iPad Pro 11"/12.9" 等) 显示 3 列
  767: 2,     // < 768：手机保持 2 列
}

/**
 * 单个卡片包装：用 IntersectionObserver 触发入场动画
 * 这样做的好处是不用再维护全局的可见性字典，动画完全依赖 DOM 可见性
 */
const PostItem = memo(function PostItem({
  post,
  isActive,
  onClick,
  onClose,
  onPostUpdated,
  onPostDeleted,
}: {
  post: Post
  isActive: boolean
  /** 稳定引用的回调（接收 postId）。⚠️ 不要在父级 map 里传内联箭头函数 ——
   *  那会让每次父级重渲染（如开/关任意帖子）都给所有 PostItem 发新 props、
   *  memo 全部失效 → 整墙卡片跟着重渲染（安卓上开帖瞬间明显掉帧）。 */
  onClick: (postId: string) => void
  onClose: () => void
  onPostUpdated?: (postId: string, updates: Partial<Post>) => void
  onPostDeleted?: (postId: string) => void
}) {
  // 每次进入视口都重新触发入场动画。离开视口后再进来，视觉上会重播"雾中浮现"
  const { ref, inView } = useInView({
    threshold: 0.05,
    // 提前一点触发，让动画不会等到卡片完全进入视口
    rootMargin: "100px 0px",
  })

  const visible = inView

  // PostCard 期望无参 onClick；在这里（memo 边界内）绑定 postId，保持引用稳定
  const handleClick = useCallback(() => onClick(post.id), [onClick, post.id])

  return (
    <div
      ref={ref}
      className={`post-card-container post-enter ${visible ? "post-enter-visible" : ""}`}
    >
      <PostCard
        post={post}
        isActive={isActive}
        onClick={handleClick}
        onClose={onClose}
        onPostUpdated={onPostUpdated}
        onPostDeleted={onPostDeleted}
        useWideTemplate={post.image_ratio ? post.image_ratio >= 1.0 : false}
      />
    </div>
  )
})

export default function VirtualPostList({
  posts = [],
  loadMorePosts,
  hasMore = false,
  loading = false,
  activePostId = null,
  onPostClick,
  onPostClose,
  onPostUpdated,
  onPostDeleted,
  pageSize = 30,
}: VirtualPostListProps) {
  // 当前已加载的页码，0 表示已加载第 0 页
  const [currentPage, setCurrentPage] = useState(0)
  const loadingMoreRef = useRef(false)
  const mountedRef = useRef(true)
  const [activePostIdInternal, setActivePostIdInternal] = useState<string | null>(null)
  const savedScrollRef = useRef(0)

  // 底部哨兵，进入视口就触发加载下一页
  const [loadMoreRef, inView] = useInView({
    rootMargin: "400px 0px", // 提前 400px 触发，避免用户看到空白
  })

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // 触底加载
  useEffect(() => {
    if (!inView || !hasMore || loading || loadingMoreRef.current || !loadMorePosts) return

    loadingMoreRef.current = true
    const nextPage = currentPage + 1

    loadMorePosts(nextPage, pageSize)
      .then(() => {
        if (mountedRef.current) {
          setCurrentPage(nextPage)
        }
      })
      .catch((err) => {
        console.error("加载更多帖子失败:", err)
      })
      .finally(() => {
        loadingMoreRef.current = false
      })
  }, [inView, hasMore, loading, loadMorePosts, pageSize, currentPage])

  // 当前激活的帖子 ID：优先用外部控制
  const currentActivePostId = activePostId !== null ? activePostId : activePostIdInternal

  const handlePostClick = useCallback(
    (postId: string) => {
      savedScrollRef.current = window.scrollY
      if (onPostClick) {
        onPostClick(postId)
      } else {
        setActivePostIdInternal(postId)
      }
    },
    [onPostClick]
  )

  const handlePostClose = useCallback(() => {
    if (onPostClose) {
      onPostClose()
    } else {
      setActivePostIdInternal(null)
    }

    // 恢复滚动位置
    if (savedScrollRef.current > 0) {
      window.scrollTo({ top: savedScrollRef.current, behavior: "auto" })
    }
  }, [onPostClose])

  // 初次加载、没有数据
  if (loading && posts.length === 0) {
    return (
      <div className="flex justify-center items-center h-32 w-full">
        <PulseLoading />
      </div>
    )
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center w-full">
        <div className="text-4xl mb-4">🌱</div>
        <h3 className="text-xl font-semibold mb-2">还没有帖子</h3>
        <p className="text-gray-500 max-w-md">成为第一个发布帖子的人！点击右下角的"+"按钮创建新帖子。</p>
      </div>
    )
  }

  return (
    <div className="w-full">
      <Masonry
        breakpointCols={breakpointColumns}
        className="masonry-grid"
        columnClassName="masonry-grid-column"
      >
        {posts.map((post) => {
          if (!post || !post.id) return null
          return (
            <PostItem
              key={post.id}
              post={post}
              isActive={currentActivePostId === post.id}
              onClick={handlePostClick}
              onClose={handlePostClose}
              onPostUpdated={onPostUpdated}
              onPostDeleted={onPostDeleted}
            />
          )
        })}
      </Masonry>

      {/* 底部加载哨兵 + 状态指示 */}
      <div ref={loadMoreRef} className="flex justify-center items-center py-8">
        {loading && posts.length > 0 && <PulseLoading />}
        {!loading && !hasMore && posts.length > 0 && (
          <div className="text-sm text-gray-500">没有更多了</div>
        )}
      </div>
    </div>
  )
}
