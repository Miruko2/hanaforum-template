"use client"

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, memo } from "react"
import { cdnUrl } from "@/lib/cdn-url"
import { toDisplayName } from "@/lib/display-name"
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
import MusicPostBody from "@/components/music-post-body"
import PostCardContent from "@/components/post-card-content"
import PostCardActions from "@/components/post-card-actions"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import CommentList, { prefetchComments } from "./comment/comment-list"
import LikeButton from "./ui/like-button"
import dynamic from "next/dynamic"
const PostDetailModal = dynamic(() => import("./post-detail-modal"), { ssr: false })
const CreatePostModal = dynamic(() => import("./create-post-modal"), { ssr: false })
import DeleteConfirmDialog from "@/components/delete-confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Card } from "@/components/ui/card"
import UserHoverCard from "@/components/user-hover-card"

// useLayoutEffect 在 paint 前同步执行，避免「内容区先以正常态闪现一帧、再开始入场动画」；
// SSR 无 DOM，退回 useEffect 以消除 React 告警。
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

// iOS（含 iPadOS 桌面化 UA：MacIntel + 多点触控）。只在客户端 effect 里使用，SSR 安全。
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))

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
  const isMobile = useIsMobile()

  // 计算派生状态 - 确保在所有可能的位置都查找用户名
  // toDisplayName: 兜底历史「邮箱被存成用户名」的残留数据，显示时截断 @ 前缀，绝不露完整邮箱
  const username = toDisplayName(post.username || post.users?.username) ||
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

  // 详情弹窗按需挂载：首次打开前完全不渲染。
  // 否则首页每张卡都会向 body portal 一个空弹窗（30+ 个空 AnimatePresence + 全套 hooks），
  // 还会在首页加载时就拉取弹窗的动态 chunk。首开后保持挂载（modalEverOpened 不回退），
  // 关闭动画 / 再次打开行为与之前完全一致。
  const [modalEverOpened, setModalEverOpened] = useState(false)
  useEffect(() => {
    if (isActive) {
      setModalEverOpened(true)
      // 点开瞬间预取评论：网络请求与弹窗 chunk 加载、开帖动画并行，
      // 评论区挂载时数据多半已就位 → 不再闪「加载评论中」。失败静默，挂载后正常拉取兜底。
      prefetchComments(post.id).catch(() => {})
    }
  }, [isActive, post.id])

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

  // 模态框打开时禁用页面滚动。
  // ⚠️ position:fixed 锁滚动只给 iOS：iOS Safari 的 overflow:hidden 锁不住触摸滚动，
  // 必须 fixed + top:-scrollY。但这套 hack 会把整个文档塌缩成视口高（巨型 reflow），
  // 关闭时「清样式（页面瞬间回到顶部）→ scrollTo 跳回原位」之间一旦被绘制一帧，
  // 用户就看到整页跳顶再跳回 —— 安卓开/关帖子「概率性闪动」的根因之一。
  // 安卓/桌面只用 overflow:hidden：移动端 overlay 滚动条不占布局宽度，
  // 切换 ≈ 零 reflow、零滚动位移，闪动根除。
  useEffect(() => {
    if (!isActive) return;
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const body = document.body.style;
    const fixedLock = isMobile && IS_IOS;
    body.overflow = 'hidden';
    if (fixedLock) {
      body.position = 'fixed';
      body.width = '100%';
      body.top = `-${scrollY}px`;
    }
    return () => {
      // 先还原样式再 scrollTo（旧实现顺序相反，靠 cleanup/effect 的执行间隙才碰巧work）
      body.overflow = '';
      if (fixedLock) {
        body.position = '';
        body.width = '';
        body.top = '';
        window.scrollTo({ top: scrollY, behavior: 'auto' });
      }
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
      // hover 增强给 wrapper(.post-card-container) 加了 scale(1.05) 放大；getBoundingClientRect
      // 含祖先 transform，会量到「放大态」矩形 → 关闭回飞落回放大态、与静止卡差 5% 跳变。
      // 量取前同步清掉 wrapper 的 hover 放大、量完即还原（同一 tick、无中间绘制 → 不闪），
      // 确保 hero 起止矩形都是静止态尺寸。
      const wrapEl = cardEl?.parentElement as HTMLElement | null
      const prevWrapTransform = wrapEl?.style.transform ?? ""
      if (wrapEl) wrapEl.style.transform = "none"
      const imgWrapEl = cardEl?.querySelector(".image-container") as HTMLElement | null
      const imgEl = cardEl?.querySelector(".image-container img") as HTMLImageElement | null
      setSourceRect(cardEl ? cardEl.getBoundingClientRect() : null)
      // 图片区矩形：关闭回飞图据此精准落回源卡图片槽（与源卡图片像素重合、不跳变）
      setSourceImgRect(imgWrapEl ? imgWrapEl.getBoundingClientRect() : null)
      setSourceSrc(imgEl ? imgEl.currentSrc || imgEl.src : null)
      if (wrapEl) wrapEl.style.transform = prevWrapTransform
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
      
      // UI 更新统一走 onPostDeleted 回调（PostGrid 里会调 context 的 deletePost）。
      // 不再在这里直接订阅 usePosts()：context value 每次帖子状态变化都重建，
      // 卡片一订阅，点赞任意一条都会让整墙卡片绕过 memo 重渲染。
      const success = await deletePostWithUIUpdate(post.id, (deletedId) => {
        if (onPostDeleted) {
          onPostDeleted(deletedId);
        }
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
  }, [user, isDeleting, post.id, toast, isActive, onClose, onPostDeleted]);

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
            <DropdownMenuTrigger className="absolute top-2 right-2 z-20 p-1.5 bg-black/30 backdrop-blur-md text-white/80 rounded-lg hover:bg-black/40">
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

        {/* 音乐分享卡：封面 + 播放区（替代普通帖子的图片区，仅 post.music 存在时渲染） */}
        {post.music && <MusicPostBody post={post} />}

        {/* 图片区域 - 仅在有真实图片 URL 时渲染（无图帖子跳过这一块，避免空白占位） */}
        {post.image_url && (
          <div className="image-container relative overflow-hidden">
            <PostCardImage 
              post={post} 
              isMobile={isMobile}
              disablePreview={true} // 在列表视图中禁用预览
              onImageLoad={(dimensions) => {
                // 比例与帖子记录不同的情况已忽略（不做无条件 log 输出）
                // 注意口径：post.image_ratio 存的是 height/width，而 dimensions.ratio
                // 是 width/height —— 直接比永远误报「差异大」，故把实测换算成 height/width 再比。
                if (
                  process.env.NODE_ENV === 'development' &&
                  dimensions.ratio > 0 &&
                  Math.abs((post.image_ratio || 1) - 1 / dimensions.ratio) > 0.2
                ) {
                  console.debug(`图片比例差异较大: ${post.image_ratio}(存h/w) vs ${1 / dimensions.ratio}(实测h/w)`);
                }
              }}
            />
          </div>
        )}

        {/* 作者头像 - 位于图片与下方内容之间，头像略微上移叠在图片底部。
            hover 头像/用户名弹出精简社交卡片，不再点击跳转。 */}
        <UserHoverCard userId={post.user_id} fallbackName={username} fallbackAvatar={avatarUrl}>
          <div
            className={cn(
              "relative z-10 flex items-center gap-2.5 px-4 group/author",
              // 有图片/音乐封面时头像上移叠在底边；无图时正常留白
              (post.image_url || post.music) ? "-mt-5" : "pt-3"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={cdnUrl(avatarUrl) || "/logo.png"}
              alt={username}
              className="h-10 w-10 rounded-full object-cover border-2 border-white/30 shadow-lg avatar-hover-effect cursor-pointer"
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
        </UserHoverCard>

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

  // 渲染模态框（首次激活前不挂载，见 modalEverOpened 注释）
  const renderModal = () => {
    if (!isMounted || !(isActive || modalEverOpened)) return null

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
      <DeleteConfirmDialog
        open={showDeleteAlert}
        onClose={() => setShowDeleteAlert(false)}
        onConfirm={handleDeletePost}
        loading={isDeleting}
        title={post.title}
      />
    </>
  )
})

export default PostCard
