"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import PostCard from "./post-card"
import VirtualPostList from "./virtual-post-list"
import type { Post } from "@/lib/types"
import { motion } from "framer-motion"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { PulseLoading } from "./ui/loading-animation"
import { usePosts } from "@/contexts/posts-context"
import { Button } from "./ui/button"
import { RefreshCw, AlertTriangle } from "lucide-react"

// 定义每页加载的帖子数
const PAGE_SIZE = 30

export default function PostGrid() {
  const [activePostId, setActivePostId] = useState<string | null>(null)
  const { user, loading: authLoading } = useSimpleAuth()
  const { state, loadMorePosts, updatePost, deletePost, retryLoading } = usePosts()
  
  // 从context中获取状态（排序已由 PostsContext 在取数层处理）
  const { posts, isLoading, hasMore, error, sort } = state
  
  // 添加用于追踪上次用户ID的引用
  const lastUserIdRef = useRef<string | null>(null);
  
  // 添加认证状态变化监听,在登录或注销后重新加载帖子
  useEffect(() => {
    // 监听自定义认证状态变化事件
    const handleAuthChange = () => {
      console.debug('🔄 PostGrid: 检测到认证状态变化事件');
      retryLoading();
    };
    
    // 监听本地存储变化
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'auth_refresh_timestamp') {
        console.debug('🔄 PostGrid: 检测到认证刷新时间戳变化');
        retryLoading();
      }
    };
    
    window.addEventListener('auth-state-changed', handleAuthChange);
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('auth-state-changed', handleAuthChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [retryLoading]);
  
  // 认证"基线"是否已建立。首次认证解析完成时只记录当前用户、不重拉，
  // 因为 PostsProvider 挂载时已经 loadPosts() 过一次了。只有之后真正的
  // 登入/登出切换才需要重拉，避免登录用户白跑一整条加载链路。
  const authBaselineSetRef = useRef(false);

  // 当登录状态"真正"改变时重新加载帖子
  useEffect(() => {
    // 认证还没解析完，先别动（此刻 user 必为 null，并不代表"已登出"）
    if (authLoading) return;

    const currentUserId = user?.id || null;

    // 首次解析完成：建立基线，不触发重拉
    if (!authBaselineSetRef.current) {
      authBaselineSetRef.current = true;
      lastUserIdRef.current = currentUserId;
      return;
    }

    if (currentUserId !== lastUserIdRef.current) {
      console.debug('👤 PostGrid: 用户ID变化，重新获取帖子数据');
      lastUserIdRef.current = currentUserId;
      retryLoading();
    }
  }, [user?.id, authLoading, retryLoading]);
  
  // 处理加载更多帖子 - 包装loadMorePosts以适配新API
  const handleLoadMorePosts = useCallback(
    (page: number, limit: number) => {
      return loadMorePosts(page, limit)
    },
    [loadMorePosts]
  )
  
  // 处理帖子点击
  const handlePostClick = useCallback((postId: string) => {
    const savedScrollPosition = window.scrollY || document.documentElement.scrollTop || 0;
    
    // 保存滚动位置到sessionStorage，以便页面刷新时恢复
    if (typeof window !== 'undefined' && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('forumScrollPosition', savedScrollPosition.toString());
      sessionStorage.setItem('modalOpen', 'true');
    }
    
    setActivePostId(postId);
  }, []);

  // 处理帖子关闭
  const handleClosePost = useCallback(() => {
    setActivePostId(null);
    
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('modalOpen');
      // 不主动恢复滚动位置，让子组件自己处理
    }
  }, []);

  // 处理帖子更新
  const handlePostUpdated = useCallback((postId: string, updates: Partial<Post>) => {
    updatePost(postId, updates);
  }, [updatePost]);

  // 处理帖子删除。
  // activePostId 用 ref 读取：若直接进依赖数组，开/关任意帖子都会让本回调换新引用，
  // 顺着 props 把所有 PostItem 的 memo 击穿 → 整墙卡片重渲染（与 PostItem 注释呼应）。
  const activePostIdRef = useRef<string | null>(null);
  activePostIdRef.current = activePostId;
  const handlePostDeleted = useCallback((postId: string) => {
    deletePost(postId);
    // 如果当前正在查看的帖子被删除，关闭详情视图
    if (activePostIdRef.current === postId) {
      setActivePostId(null);
    }
  }, [deletePost]);

  // 处理重试加载
  const handleRetry = useCallback(() => {
    retryLoading();
  }, [retryLoading]);

  // 调试日志（仅开发模式输出一次，避免刷屏）
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && error) {
      console.debug('🔍 PostGrid 加载异常:', { postsCount: posts.length, error });
    }
  }, [error, posts.length]);

  return (
    <div className="post-grid-container w-full max-w-[2200px] mx-auto pb-20">
      {/* 加载中状态 */}
      {isLoading && posts.length === 0 && (
        <div className="flex justify-center items-center h-32">
          <PulseLoading />
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="flex flex-col items-center justify-center py-8 text-center mx-auto px-4">
          <div className="flex items-center mb-4 text-red-500">
            <AlertTriangle className="mr-2" />
            <span>加载出错</span>
          </div>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button 
            onClick={handleRetry} 
            variant="outline"
            size="sm"
            className="flex items-center"
          >
            <RefreshCw className="w-4 h-4 mr-2" /> 
            重试加载
          </Button>
        </div>
      )}

      {/* 帖子网格 */}
      {posts.length > 0 && (
        <div
          className="post-grid-layout w-full px-4"
          style={{ opacity: 1, visibility: 'visible', display: 'block' }}
        >
          {/* 虚拟化列表组件 */}
          <VirtualPostList
            posts={posts}
            loadMorePosts={handleLoadMorePosts}
            hasMore={hasMore}
            loading={isLoading}
            activePostId={activePostId}
            onPostClick={handlePostClick}
            onPostClose={handleClosePost}
            onPostUpdated={handlePostUpdated}
            onPostDeleted={handlePostDeleted}
            pageSize={PAGE_SIZE}
          />
        </div>
      )}

      {/* 无内容状态 */}
      {!isLoading && !error && posts.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-gray-500">
          {sort === 'following' ? (
            <>
              <p className="text-xl mb-4">还没有关注的人发帖</p>
              <p className="text-sm">去关注更多有趣的人吧</p>
            </>
          ) : (
            <>
              <p className="text-xl mb-4">暂无帖子</p>
              <p className="text-sm">成为第一个发帖的人吧</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}