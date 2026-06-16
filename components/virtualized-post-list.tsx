"use client"

import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import PostCard from "./post-card"
import type { Post } from "@/lib/types"
import { motion } from "framer-motion"
import { useInView } from "react-intersection-observer"
import { LoadingAnimation } from "./ui/loading-animation"
import { useIsMobile, BREAKPOINTS } from "@/hooks/use-mobile"
import { FixedSizeList as List, ListChildComponentProps } from 'react-window'

interface VirtualizedPostListProps {
  posts: Post[]
  loadMorePosts?: () => Promise<void>
  hasMore?: boolean
  loading?: boolean
}

export default function VirtualizedPostList({
  posts = [],
  loadMorePosts,
  hasMore = false,
  loading = false,
}: VirtualizedPostListProps) {
  const [activePostId, setActivePostId] = useState<string | null>(null)
  const isMobile = useIsMobile()
  const mountedRef = useRef(true)
  const [loadMoreRef, inView] = useInView({
    threshold: 0.1,
    triggerOnce: false,
  })
  const savedScrollPositionRef = useRef<number>(0)
  const loadingMoreRef = useRef(false)
  const listRef = useRef<List>(null)
  const [layoutError, setLayoutError] = useState<string | null>(null)
  const [windowSize, setWindowSize] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0,
  })
  
  // 虚拟列表状态
  const [visibleStartIndex, setVisibleStartIndex] = useState(0)
  const [visibleStopIndex, setVisibleStopIndex] = useState(0)
  const [itemSize, setItemSize] = useState(isMobile ? 300 : 400) // 估算的平均帖子高度
  
  // 组件挂载/卸载处理
  useEffect(() => {
    mountedRef.current = true
    
    console.debug("🏗️ VirtualizedPostList挂载:", {
      postsCount: posts?.length || 0,
      isMobile,
      firstPostId: posts?.[0]?.id || "无帖子",
      firstPostTitle: posts?.[0]?.title || "无帖子"
    });
    
    // 添加窗口尺寸变化监听
    const handleResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight - 200, // 减去页面头部和其他元素的高度
      })
      // 窗口大小变化时重新计算帖子高度
      setItemSize(window.innerWidth < BREAKPOINTS.md ? 300 : 400)
    }
    
    // 初始设置
    handleResize();
    
    window.addEventListener('resize', handleResize)
    
    return () => {
      mountedRef.current = false
      window.removeEventListener('resize', handleResize)
    }
  }, [posts, isMobile])
  
  // 计算瀑布流布局 - 这里只用于计算列数，实际布局由虚拟列表处理
  const { columnCount } = useMemo(() => {
    try {
      // 更精确的列数计算
      let columnCount = 3; // 默认桌面大屏幕是3列
      
      if (window.innerWidth < BREAKPOINTS.xl) { // 1280px以下
        columnCount = 2; // 中等屏幕
      }
      
      if (window.innerWidth < BREAKPOINTS.md) { // 768px以下
        columnCount = 1; // 移动设备
      }
      
      return { columnCount };
    } catch (error) {
      console.error("❌ 瀑布流布局计算失败:", error);
      setLayoutError("布局计算失败，请刷新页面重试");
      
      return { columnCount: window.innerWidth < BREAKPOINTS.md ? 1 : 2 };
    }
  }, [windowSize]);
  
  // 将帖子分配到各列
  const columns = useMemo(() => {
    if (!Array.isArray(posts) || posts.length === 0) {
      return Array(columnCount).fill(null).map(() => []);
    }
    
    // 创建空列
    const cols: Post[][] = Array(columnCount).fill(null).map(() => []);
    
    // 简单地将帖子平均分配到各列
    posts.forEach((post, index) => {
      const columnIndex = index % columnCount;
      cols[columnIndex].push(post);
    });
    
    return cols;
  }, [posts, columnCount]);
  
  // 触发加载更多
  const loadMorePostsHandler = useCallback(() => {
    if (!loadMorePosts || typeof loadMorePosts !== 'function') {
      console.warn("⚠️ loadMorePosts未定义或不是函数");
      return Promise.resolve();
    }
    
    console.debug("📥 触发加载更多帖子...");
    return loadMorePosts().catch(error => {
      console.error('❌ 加载更多帖子时出错:', error);
    });
  }, [loadMorePosts]);
  
  // 监听滚动到底部以加载更多
  useEffect(() => {
    if (!mountedRef.current) return;
    if (!inView) return;
    if (!hasMore || loading || loadingMoreRef.current) return;
    
    console.debug("👁️ 加载更多触发器可见 - 开始加载更多帖子");
    
    loadingMoreRef.current = true;
    let isCancelled = false;
    
    const performLoad = async () => {
      try {
        await loadMorePostsHandler();
      } finally {
        if (!isCancelled && mountedRef.current) {
          loadingMoreRef.current = false;
        }
      }
    };
    
    performLoad();
    
    return () => {
      isCancelled = true;
    };
  }, [inView, hasMore, loading, loadMorePostsHandler]);
  
  // 处理帖子点击
  const handlePostClick = useCallback((postId: string) => {
    if (!mountedRef.current) return;
    savedScrollPositionRef.current = window.scrollY || 0;
    setActivePostId(postId);
  }, []);
  
  // 处理帖子关闭
  const handlePostClose = useCallback(() => {
    if (!mountedRef.current) return;
    setActivePostId(null);
    
    if (savedScrollPositionRef.current > 0) {
      requestAnimationFrame(() => {
        if (mountedRef.current) {
          window.scrollTo({
            top: savedScrollPositionRef.current,
            behavior: 'auto'
          });
        }
      });
    }
  }, []);
  
  // 处理列表滚动
  const handleScroll = useCallback(({ scrollOffset, scrollUpdateWasRequested }: { scrollOffset: number, scrollUpdateWasRequested: boolean }) => {
    if (scrollUpdateWasRequested) return;
    
    // 更新当前滚动位置
    savedScrollPositionRef.current = scrollOffset;
    
    // 如果靠近底部且有更多内容，加载更多
    const windowHeight = window.innerHeight;
    const scrollBottom = scrollOffset + windowHeight;
    const totalHeight = posts.length * itemSize;
    const nearBottom = totalHeight - scrollBottom < windowHeight * 0.5;
    
    if (nearBottom && hasMore && !loading && !loadingMoreRef.current) {
      loadMorePostsHandler();
    }
  }, [posts.length, itemSize, hasMore, loading, loadMorePostsHandler]);
  
  // 渲染单个列的帖子
  const renderColumn = (columnIndex: number) => {
    const columnPosts = columns[columnIndex] || [];
    
    // 渲染列函数
    const renderColumnPosts = ({ index, style }: ListChildComponentProps) => {
      const post = columnPosts[index];
      if (!post) return null;
      
      // image_ratio 存的是 height/width：>=1 = 竖图。此值当前是 dead path
      // （GlassMorph 的 wideTemplate 需配 adaptiveHeight 才生效，而无调用方传 adaptiveHeight）。
      const useWideTemplate = post.image_ratio ? post.image_ratio >= 1.0 : false;
      
      return (
        <div style={{
          ...style,
          paddingBottom: isMobile ? 0 : 15,
          paddingRight: columnIndex < columnCount - 1 ? 12 : 0,
          paddingLeft: columnIndex > 0 ? 12 : 0,
          transition: 'opacity 0.3s ease'
        }}>
          <motion.div
            className="w-full"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: isMobile ? -15 : 0 }}
            transition={{
              type: "spring",
              stiffness: 260,
              damping: 20,
              duration: 0.3,
              delay: index * 0.05 // Staggered animation
            }}
          >
            <PostCard
              post={post}
              isActive={activePostId === post.id}
              onClick={() => handlePostClick(post.id)}
              onClose={handlePostClose}
              onPostUpdated={() => {}} // 父组件处理
              onPostDeleted={() => {}} // 父组件处理
              useWideTemplate={useWideTemplate}
            />
          </motion.div>
        </div>
      );
    };
    
    return (
      <div 
        key={`column-${columnIndex}`}
        className="h-full"
        style={{
          width: `calc(${100 / columnCount}% - ${columnCount > 1 ? '0.75rem' : '0px'})`,
          marginLeft: columnIndex > 0 ? '0.75rem' : '0',
        }}
      >
        {columnPosts.length > 0 && (
          <List
            ref={listRef}
            height={windowSize.height || 800}
            width={(windowSize.width / columnCount) - (columnCount > 1 ? 20 : 0)}
            itemCount={columnPosts.length}
            itemSize={itemSize}
            overscanCount={5} // 预渲染额外的帖子，使滚动更流畅
            onScroll={handleScroll}
            onItemsRendered={({ visibleStartIndex: start, visibleStopIndex: stop }) => {
              setVisibleStartIndex(start);
              setVisibleStopIndex(stop);
            }}
          >
            {renderColumnPosts}
          </List>
        )}
      </div>
    );
  };
  
  // 诊断输出
  console.debug("🔄 虚拟列表PostList渲染:", {
    postsCount: posts?.length || 0,
    columnCount,
    visibleRange: `${visibleStartIndex}-${visibleStopIndex}`,
    loading,
    hasMore
  });
  
  // 如果加载中且没有帖子，显示加载状态
  if (loading && (!Array.isArray(posts) || posts.length === 0)) {
    console.debug("⏳ 显示初始加载状态");
    return (
      <div className="flex justify-center items-center h-32 w-full">
        <LoadingAnimation size="md" color="text-lime-500" />
      </div>
    );
  }
  
  // 如果布局计算出错，显示错误状态
  if (layoutError) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center w-full">
        <div className="text-3xl mb-4 text-red-500">⚠️</div>
        <h3 className="text-xl font-semibold mb-2 text-red-400">{layoutError}</h3>
        <button 
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md"
        >
          刷新页面
        </button>
      </div>
    );
  }
  
  // 如果没有帖子，显示空状态
  if (!Array.isArray(posts) || posts.length === 0) {
    console.debug("🈳 显示空状态 - 没有帖子");
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center w-full">
        <div className="text-4xl mb-4">🌱</div>
        <h3 className="text-xl font-semibold mb-2">还没有帖子</h3>
        <p className="text-gray-500 max-w-md">成为第一个发布帖子的人！点击右下角的"+"按钮创建新帖子。</p>
      </div>
    );
  }
  
  // 使用虚拟列表渲染帖子
  return (
    <div className="w-full" style={{ height: `${windowSize.height}px` }}>
      <div className="flex w-full h-full">
        {Array.from({ length: columnCount }).map((_, index) => renderColumn(index))}
      </div>
      
      {/* 加载更多指示器 */}
      <div ref={loadMoreRef} className="flex justify-center items-center py-4 mt-2">
        {loading && <LoadingAnimation size="md" color="text-lime-500" />}
        {!loading && hasMore && <div className="h-6 flex items-center justify-center text-sm text-gray-400">
          上滑加载更多...
        </div>}
      </div>
    </div>
  );
} 