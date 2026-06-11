"use client"

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, memo } from "react"
import { MoreVertical, MessageSquare, ThumbsUp, Trash2, X, AlertCircle, Pin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createPortal } from "react-dom"
import { likePost, unlikePost } from "@/lib/supabase"
import { deletePostWithUIUpdate } from "@/lib/post-delete-fix"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import type { Post } from "@/lib/types"
import HoverCardEffect from "@/components/hover-card-effect"
import PostCardImage from "@/components/post-card-image"
import PostCardContent from "@/components/post-card-content"
import PostCardActions from "@/components/post-card-actions"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import CommentList from "./comment/comment-list"
import LikeButton from "./ui/like-button"
import dynamic from "next/dynamic"
const PostDetailModal = dynamic(() => import("./post-detail-modal"), { ssr: false })
const CreatePostModal = dynamic(() => import("./create-post-modal"), { ssr: false })
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePosts } from "@/contexts/posts-context"
import { Card } from "@/components/ui/card"
import { useRouter } from "next/navigation"

// useLayoutEffect 在 paint 前同步执行，避免「内容区先以正常态闪现一帧、再开始入场动画」；
// SSR 无 DOM，退回 useEffect 以消除 React 告警。
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

interface PostCardProps {
  post: Post
  isActive?: boolean
  onClick?: () => void
  onClose?: () => void
  onPostUpdated?: (postId: string, updates: Partial<Post>) => void
  onPostDeleted?: (postId: string) => void
  userLiked?: boolean
  useWideTemplate?: boolean
  className?: string
}

// 使用memo包装整个组件以减少不必要的重渲染
const PostCard = memo(function PostCard({ 
  post, 
  isActive = false, 
  onClick, 
  onClose, 
  onPostUpdated, 
  onPostDeleted, 
  userLiked,
  useWideTemplate = false,
  className = "",
}: PostCardProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [liked, setLiked] = useState(userLiked || false)
  const [likeCount, setLikeCount] = useState(post.likes_count || 0)
  const [isMounted, setIsMounted] = useState(false)
  const [isLiking, setIsLiking] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  // hero 转场：点击瞬间量出本卡图片的屏幕矩形，传给详情页作为放大起点
  const [sourceRect, setSourceRect] = useState<DOMRect | null>(null)
  // hero 关闭回飞：图片区（image-container）的屏幕矩形 —— 回飞图精准落回这里，
  // 与源卡图片像素级重合，避免「整卡全图」落到「上图下文卡」时的高度跳变。
  const [sourceImgRect, setSourceImgRect] = useState<DOMRect | null>(null)
  // hero 转场：列表图已加载的实际 URL（飞行图用它即时显示、不闪）
  const [sourceSrc, setSourceSrc] = useState<string | null>(null)
  // hero 关闭回飞落地后，源卡内容区（图片下方）做一次浮现入场，柔化「内容突现」
  const [heroReturn, setHeroReturn] = useState(false)
  
  const cardRef = useRef<HTMLDivElement>(null)
  const mountedRef = useRef(true) // 跟踪组件是否已挂载
  const prevActiveRef = useRef(isActive) // 跟踪上一次激活态，用于检测 hero 关闭返回
  const { user, isAdmin } = useSimpleAuth()
  const { toast } = useToast()
  const { deletePost } = usePosts()
  const isMobile = useIsMobile()
  const router = useRouter()

  // 计算派生状态 - 确保在所有可能的位置都查找用户名
  const username = post.username || 
                   post.users?.username || 
                   `用户_${post.user_id.substring(0, 6)}`;
  const avatarUrl = post.users?.avatar_url || null;

  const isAuthor = Boolean(user && post.user_id === user.id)
  const canDelete = Boolean(user && (isAuthor || isAdmin))

  // 更新点赞状态
  useEffect(() => {
    setLiked(userLiked || false)
  }, [userLiked])

  // 客户端挂载检查
  useEffect(() => {
    setIsMounted(true)
    return () => {
      setIsMounted(false)
      mountedRef.current = false
    }
  }, [])

  // hero 关闭返回检测：isActive 由「开 → 关」、且本次走过桌面 hero（量到源图）时，
  // 触发源卡内容区登场动画。时机正好落在回飞图落地、源卡整卡显形的那一刻。
  // 必须用 layout effect：普通 useEffect 在 paint 之后才置 heroReturn，会先把内容区以正常态
  // 画出来一帧（用户看到的「瞬间突兀出现」），动画形同虚设；layout effect 在 paint 前同步置位，
  // 内容区首帧就是动画起点（opacity 0），从头渐入。
  useIsomorphicLayoutEffect(() => {
    const wasActive = prevActiveRef.current
    prevActiveRef.current = isActive
    if (wasActive && !isActive && sourceSrc) {
      setHeroReturn(true)
    }
  }, [isActive, sourceSrc])

  // 保存打开模态框前的滚动位置
  const savedScrollYRef = useRef(0);

  // 处理模态框打开时禁用页面滚动
  useEffect(() => {
    if (isActive) {
      // 保存当前滚动位置
      savedScrollYRef.current = window.scrollY || document.documentElement.scrollTop || 0;
      
      if (isMobile) {
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
        document.body.style.top = `-${savedScrollYRef.current}px`;
      } else {
        document.body.style.overflow = 'hidden';
      }
    } else {
      // 恢复滚动位置（移动端需要）
      if (isMobile && savedScrollYRef.current > 0) {
        window.scrollTo({ top: savedScrollYRef.current, behavior: 'auto' });
      }
      
      // 移除所有样式
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
    }

    return () => {
      // 确保组件卸载时清理样式并恢复滚动位置
      if (savedScrollYRef.current > 0) {
        window.scrollTo({ top: savedScrollYRef.current, behavior: 'auto' });
      }
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
    };
  }, [isActive, isMobile]);

  // 处理点赞 - 乐观更新 + 静态导出优化
  const handleLike = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()

    if (!user) {
      toast({
        title: "请先登录",
        description: "点赞前请先登录账号",
        variant: "destructive",
      })
      return
    }

    if (isLiking) return

    try {
      setIsLiking(true)
      
      // 乐观更新UI
      const newLiked = !liked
      const newCount = newLiked ? likeCount + 1 : likeCount - 1
      setLiked(newLiked)
      setLikeCount(newCount)

      // 在静态导出环境下，直接调用Supabase API
      if (newLiked) {
        await likePost(post.id, user.id)
      } else {
        await unlikePost(post.id, user.id)
      }

      // 更新父组件状态
      if (onPostUpdated) {
        onPostUpdated(post.id, { likes_count: newCount })
      }
    } catch (error: any) {
      // 防止在组件卸载后进行状态更新
      if (!mountedRef.current) return
      
      // 回滚UI状态
      setLiked(!liked)
      setLikeCount(likeCount)
      
      // 在静态导出环境下提供更详细的错误信息
      let errorMessage = "点赞操作失败，请稍后重试"
      
      if (error.message?.includes("JWT")) {
        errorMessage = "登录状态已过期，请重新登录"
      } else if (error.message?.includes("RLS")) {
        errorMessage = "数据访问权限不足"
      } else if (error.message?.includes("network") || error.message?.includes("fetch")) {
        errorMessage = "网络连接失败，请检查网络后重试"
      }
      
      toast({
        title: "操作失败",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      // 防止在组件卸载后进行状态更新
      if (mountedRef.current) {
        setIsLiking(false)
      }
    }
  }, [user, isLiking, liked, likeCount, post.id, onPostUpdated, toast])

  // 处理评论点击
  const handleComment = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isActive && onClick) {
      onClick()
    }
  }, [isActive, onClick])

  // 处理卡片点击
  const handleCardClick = useCallback((e: React.MouseEvent) => {
    if (!isActive && onClick) {
      // hero 转场：量出整张卡片的屏幕矩形（起点）+ 卡片图已加载的 URL（飞行图图源）。
      // 用整卡矩形而非只图片，让「整个帖子元素」一起飞、底部信息再淡出。
      const cardEl = cardRef.current
      const imgWrapEl = cardEl?.querySelector(".image-container") as HTMLElement | null
      const imgEl = cardEl?.querySelector(".image-container img") as HTMLImageElement | null
      setSourceRect(cardEl ? cardEl.getBoundingClientRect() : null)
      // 图片区矩形：关闭回飞图据此精准落回源卡图片槽（与源卡图片像素重合、不跳变）
      setSourceImgRect(imgWrapEl ? imgWrapEl.getBoundingClientRect() : null)
      setSourceSrc(imgEl ? imgEl.currentSrc || imgEl.src : null)
      onClick()
    }
  }, [isActive, onClick])

  // 处理评论添加后的回调
  const handleCommentAdded = useCallback(() => {
    if (onPostUpdated) {
      onPostUpdated(post.id, {
        comments_count: (post.comments_count || 0) + 1,
      })
    }
  }, [post.id, post.comments_count, onPostUpdated])

  // 处理删除帖子
  const handleDeletePost = useCallback(async () => {
    if (!user || isDeleting) return;

    try {
      setIsDeleting(true);
      
      // 如果在详情视图中，先关闭它以避免UI抖动
      if (isActive && onClose) {
        onClose();
      }
      
      // 显示正在删除的提示
      toast({
        title: "正在删除",
        description: "删除操作进行中...",
      });
      
      // 使用上下文进行UI更新而不是页面刷新
      const success = await deletePostWithUIUpdate(post.id, (deletedId) => {
        // 通知父组件帖子已删除
        if (onPostDeleted) {
          onPostDeleted(deletedId);
        }
        // 同时更新上下文状态
        deletePost(deletedId);
      });
      
      if (success) {
        toast({
          title: "删除成功",
          description: "帖子已成功删除",
        });
      }
    } catch (error) {
      toast({
        title: "删除失败",
        description: "删除帖子时出错，请稍后重试",
        variant: "destructive",
      });
      setIsDeleting(false);
      setShowDeleteAlert(false);
    }
  }, [user, isDeleting, post.id, toast, isActive, onClose, onPostDeleted, deletePost]);

  // 渲染缩略图卡片
  const renderCard = () => {
    // 移动端使用更小的底部外边距
    const marginBottomClass = isMobile ? 'mb-0' : 'mb-6';
    
    // 根据模板类型选择不同的样式
    const templateClass = useWideTemplate ? 'wide-template' : 'tall-template';

    return (
      <div
        ref={cardRef}
        className={`post-card glass-card will-change-transform ${marginBottomClass} ${templateClass} ${className}`}
        onClick={handleCardClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          position: 'relative',
          zIndex: 1,
          // hero 转场期间（本卡打开 + 本卡有图 → 才会走飞行转场，桌面/平板/手机都走）隐藏本卡，
          // 视觉上「整个帖子被拿起来飞到详情中间」，避免列表残留原卡。无图帖子不隐藏（不走 hero）。
          // 用 visibility 而非 opacity：inline opacity 会覆盖 .post-enter 入场动画的 opacity:0
          // 「雾态」，使未进视口的缓冲区卡片提前以模糊态显形（先空玻璃卡、后加载成帖子）；
          // visibility 不参与入场动画，hero 隐藏与「雾中浮现」互不干扰。
          visibility: isActive && sourceSrc ? 'hidden' : undefined,
          ...(useWideTemplate && isMobile ? {
            marginLeft: '-2%',
            width: '104%'
          } : {})
        }}
      >
        {/* 管理员标识和菜单 */}
        {isAdmin && (
          <div className="absolute top-2 left-2 z-10 bg-red-500/30 backdrop-blur-md text-white text-xs px-2 py-1 rounded-md flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            <span>管理员</span>
          </div>
        )}
        
        {canDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger className="absolute top-2 right-2 z-10 p-1.5 bg-black/30 backdrop-blur-md text-white/80 rounded-lg hover:bg-black/40">
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isAuthor && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowEditModal(true)
                  }}
                  className="text-blue-400 hover:text-blue-300"
                >
                  <svg className="h-4 w-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  编辑帖子
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDeleteAlert(true)
                }}
                className="text-red-400 hover:text-red-300"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                删除帖子
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* 图片区域 - 仅在有真实图片 URL 时渲染（无图帖子跳过这一块，避免空白占位） */}
        {post.image_url && (
          <div className="image-container relative overflow-hidden">
            <PostCardImage 
              post={post} 
              isMobile={isMobile}
              disablePreview={true} // 在列表视图中禁用预览
              onImageLoad={(dimensions) => {
                // 比例与帖子记录不同的情况已忽略（不做无条件 log 输出）
                if (
                  process.env.NODE_ENV === 'development' &&
                  post.image_ratio !== dimensions.ratio &&
                  dimensions.ratio > 0 &&
                  Math.abs((post.image_ratio || 1) - dimensions.ratio) > 0.2
                ) {
                  console.debug(`图片比例差异较大: ${dimensions.ratio} vs ${post.image_ratio}`);
                }
              }}
            />
          </div>
        )}

        {/* 作者头像 - 位于图片与下方内容之间，头像略微上移叠在图片底部，点击进入作者主页 */}
        <div
          className={cn(
            "relative z-10 flex items-center gap-2.5 px-4 cursor-pointer group/author",
            // 有图片时头像上移叠在图片底边；无图片时正常留白
            post.image_url ? "-mt-5" : "pt-3"
          )}
          onClick={(e) => {
            e.stopPropagation()
            router.push(`/user?id=${post.user_id}`)
          }}
          title={`查看 ${username} 的主页`}
        >
          <img
            src={avatarUrl || "/logo.png"}
            alt={username}
            className="h-10 w-10 rounded-full object-cover border-2 border-white/30 shadow-lg avatar-hover-effect"
            onError={(e) => {
              // 头像 URL 失效时回退到站点 logo，避免出现裂图
              const img = e.currentTarget
              if (img.src.indexOf("/logo.png") === -1) img.src = "/logo.png"
            }}
          />
          <span className="relative top-3 truncate text-sm font-medium text-white transition-colors group-hover/author:text-lime-400">
            {username}
          </span>
        </div>

        {/* 头像与标题之间的分隔线 */}
        <div className="mx-4 mt-2.5 border-t border-white/10" />

        {/* 内容区域 */}
        <div
          className={cn("px-2 pb-1 pt-1", heroReturn && "hero-return-content")}
          onAnimationEnd={(e) => {
            // 只认本元素的浮现动画结束，避免子元素动画冒泡误清状态
            if (e.target === e.currentTarget) setHeroReturn(false)
          }}
        >
          <PostCardContent
            post={post}
            username={username}
            isAdmin={isAdmin}
            isAuthor={isAuthor}
            liked={liked}
            likeCount={likeCount}
            isLiking={isLiking}
            onLike={handleLike}
            onComment={handleComment}
          />
        </div>
      </div>
    );
  };

  // 渲染模态框
  const renderModal = () => {
    if (!isMounted) return null

    return (
      <PostDetailModal
        post={post}
        isOpen={isActive}
        onClose={onClose || (() => {})}
        onLike={handleLike}
        onCommentAdded={handleCommentAdded}
        liked={liked}
        likeCount={likeCount}
        isLiking={isLiking}
        username={username}
        avatarUrl={avatarUrl}
        isMobile={isMobile}
        isAdmin={isAdmin}
        onPostUpdated={onPostUpdated}
        sourceRect={sourceRect}
        sourceImgRect={sourceImgRect}
        sourceSrc={sourceSrc}
      />
    )
  }

  return (
    <>
      {renderCard()}
      {renderModal()}
      
      {/* 编辑帖子模态框 */}
      {showEditModal && isMounted && (
        <CreatePostModal
          editPost={post}
          onClose={() => setShowEditModal(false)}
          onPostUpdated={(postId, updates) => {
            if (onPostUpdated) {
              onPostUpdated(postId, updates)
            }
          }}
          onPostCreated={() => {
            setShowEditModal(false)
          }}
        />
      )}
      
      {/* 删除确认对话框 */}
      <AlertDialog open={showDeleteAlert} onOpenChange={setShowDeleteAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              你确定要删除这个帖子吗？这个操作不可撤销，所有评论也将被删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePost}
              disabled={isDeleting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {isDeleting ? '删除中...' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
})

export default PostCard
