"use client"

import { useMemo } from "react"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import PostCardActions from "./post-card-actions"
import type { Post } from "@/lib/types"
import { cn } from "@/lib/utils"
import { CATEGORY_LABELS } from "@/lib/categories"
import { useRouter } from "next/navigation"

interface PostCardContentProps {
  post: Post
  username: string
  isAdmin: boolean
  isAuthor: boolean
  liked: boolean
  likeCount: number
  isLiking: boolean
  onLike: (e: React.MouseEvent) => void
  onComment: (e: React.MouseEvent) => void
}

export default function PostCardContent({
  post,
  username,
  isAdmin,
  isAuthor,
  liked,
  likeCount,
  isLiking,
  onLike,
  onComment
}: PostCardContentProps) {
  const router = useRouter()

  // 格式化日期 - 使用useMemo缓存结果
  const formattedDate = useMemo(() => {
    return post.created_at 
      ? formatDistanceToNow(new Date(post.created_at), { addSuffix: true, locale: zhCN }) 
      : ""
  }, [post.created_at])

  return (
    <div className="p-3 pl-2 pt-2 pb-2">
      <h3 className="text-base font-medium text-white mb-1.5 line-clamp-1" title={post.title}>
        {post.title}
      </h3>

      <div className="flex justify-between items-center mb-2 pl-0">
        <span className="text-xs font-medium text-white/90 px-2 py-1 bg-black/25 rounded-full -ml-2">{CATEGORY_LABELS[post.category] || post.category}</span>
        
        <div className="mr-1">
          <PostCardActions
            liked={liked}
            likeCount={likeCount}
            commentsCount={post.comments_count || 0}
            isLiking={isLiking}
            onLike={onLike}
            onComment={onComment}
          />
        </div>
      </div>

      {/* 帖子正文摘要：全平台（手机/平板/PC）首页列表卡片都不显示。
          只保留标题 + 分类 + 互动数 + 作者/时间。
          完整正文走点开后的详情弹窗（PostDetailModal）。
          理由：避免卡片高度参差不齐影响瀑布流观感，同时减少首页信息密度。 */}

      <div className="flex justify-end items-center text-xs text-white/70 gap-2">
        <span className="whitespace-nowrap flex-shrink-0" title={new Date(post.created_at).toLocaleString()}>
          {formattedDate}
        </span>
      </div>
    </div>
  )
} 