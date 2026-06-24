"use client"

import { useCallback, memo } from "react"
import { MessageSquare } from "lucide-react"
import { cn } from "@/lib/utils"
import LikeButton from "./ui/like-button"
import CollectButton from "./ui/collect-button"

interface PostCardActionsProps {
  liked: boolean
  likeCount: number
  commentsCount: number
  isLiking: boolean
  collected: boolean
  isCollecting: boolean
  onLike: (e: React.MouseEvent) => void
  onComment: (e: React.MouseEvent) => void
  onCollect: (e: React.MouseEvent) => void
}

// 使用memo包装组件减少不必要的重渲染
const PostCardActions = memo(function PostCardActions({
  liked,
  likeCount,
  commentsCount,
  isLiking,
  collected,
  isCollecting,
  onLike,
  onComment,
  onCollect
}: PostCardActionsProps) {
  // 优化点击处理函数，使用passive触摸事件
  const handleLikeClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    
    // 防止快速连点触发多次
    if (isLiking) return
    
    // 添加触觉反馈（如果设备支持）
    if (window.navigator && 'vibrate' in window.navigator) {
      try {
        navigator.vibrate(10) // 非常短的触觉反馈
      } catch (e) {
        // 忽略错误
      }
    }
    
    onLike(e)
  }, [onLike, isLiking])

  const handleCommentClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onComment(e)
  }, [onComment])

  const handleCollectClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (isCollecting) return
    if (window.navigator && 'vibrate' in window.navigator) {
      try {
        navigator.vibrate(10)
      } catch (e) {
        // 忽略错误
      }
    }
    onCollect(e)
  }, [onCollect, isCollecting])

  return (
    <div className="flex items-center gap-2 ml-2">
      <LikeButton
        liked={liked}
        count={likeCount}
        isLoading={isLiking}
        onClick={handleLikeClick}
        size="sm"
        className="py-1 px-2"
      />

      {/* 无底无框，仅 hover 时浮现淡背景；图标尺寸/内边距与 LikeButton(sm) 一致，
          保证点赞图标、点赞数、评论图标、评论数同一水平线 */}
      <button
        className="flex items-center gap-1 px-2 py-1.5 rounded-full text-xs text-white/80 hover:bg-white/15 transition-colors"
        onClick={handleCommentClick}
        aria-label="查看评论"
      >
        <MessageSquare className="h-4 w-4" />
        <span>{commentsCount}</span>
      </button>

      {/* 收藏：私密开关，不带数字；与点赞/评论同一水平线 */}
      <CollectButton
        collected={collected}
        isLoading={isCollecting}
        onClick={handleCollectClick}
        size="sm"
        className="py-1 px-2"
      />
    </div>
  )
})

// 添加显示名称以便于调试
PostCardActions.displayName = 'PostCardActions'

export default PostCardActions 