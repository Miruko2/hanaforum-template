"use client"

import { useState, useEffect } from "react"
import { cdnUrl } from "@/lib/cdn-url"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { formatDate, cn } from "@/lib/utils"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { Reply, ThumbsUp, Trash2 } from "lucide-react"
import type { Comment } from "@/lib/types"
import CommentForm from "./comment-form"
import { checkCommentLiked, likeComment, unlikeComment, getCommentLikesCount, deleteComment } from "@/lib/supabase"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
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

export interface CommentItemProps {
  comment: Comment
  postId: string
  onCommentAdded?: (comment: Comment | null) => void
  onCommentDeleted?: (commentId: string) => void
  level?: number
  isOptimistic?: boolean
  isAdmin?: boolean   // 当前用户是否是管理员
}

export default function CommentItem({
  comment,
  postId,
  onCommentAdded,
  onCommentDeleted,
  level = 0,
  isOptimistic = false,
  isAdmin = false
}: CommentItemProps) {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isLiked, setIsLiked] = useState(false)
  const [likesCount, setLikesCount] = useState(comment.likes_count || comment.likes || 0)
  const [isLiking, setIsLiking] = useState(false)
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const { user } = useSimpleAuth()
  const { toast } = useToast()
  const router = useRouter()
  const goToProfile = () => router.push(`/user?id=${comment.user_id}`)

  // 是否本人评论；本人或管理员均可删除（非乐观更新中的临时评论）
  const isAuthor = !!user && user.id === comment.user_id
  const canDelete = !isOptimistic && (isAuthor || isAdmin)

  // 最大嵌套层级
  const MAX_NESTING_LEVEL = 3

  // 限制嵌套回复层级
  const canReply = level < MAX_NESTING_LEVEL

  // 获取用户名首字母作为头像备用显示
  const getInitial = (username?: string) => {
    return username ? username.charAt(0).toUpperCase() : "U"
  }

  // 用户名显示逻辑
  const displayName = comment.user?.username || comment.username || "匿名用户"

  // 头像URL：无头像用户统一使用站点 logo 作为默认头像
  const avatarUrl = comment.user?.avatar_url || "/logo.png"

  // 检查用户是否已点赞该评论
  useEffect(() => {
    if (!user || isOptimistic) return

    const checkLikeStatus = async () => {
      try {
        const liked = await checkCommentLiked(comment.id, user.id)
        setIsLiked(!!liked)
      } catch (err) {
        console.error("获取点赞状态失败:", err)
      }
    }

    checkLikeStatus()
  }, [comment.id, user, isOptimistic])

  // 获取最新的点赞数
  useEffect(() => {
    if (isOptimistic) return
    
    const fetchLikesCount = async () => {
      try {
        const count = await getCommentLikesCount(comment.id)
        setLikesCount(count)
      } catch (err) {
        console.error("获取评论点赞数失败:", err)
      }
    }
    
    fetchLikesCount()
    
    // 创建实时订阅
    const channel = supabase
      .channel(`comment-likes-${comment.id}`)
      .on('postgres_changes', 
        { 
          event: '*', 
          schema: 'public', 
          table: 'comment_likes',
          filter: `comment_id=eq.${comment.id}` 
        }, 
        async () => {
          // 当有点赞变化时，重新获取点赞数
          fetchLikesCount()
        })
      .subscribe()
    
    return () => {
      channel.unsubscribe()
    }
  }, [comment.id])

  // 处理评论点赞/取消点赞
  const handleLikeToggle = async () => {
    if (!user) {
      alert("请先登录后再点赞")
      return
    }

    if (isLiking || isOptimistic) return
    
    try {
      setIsLiking(true)
      
      // 立即更新UI状态，提升响应速度
      const newLikeStatus = !isLiked
      setIsLiked(newLikeStatus)
      setLikesCount(prev => newLikeStatus ? prev + 1 : Math.max(0, prev - 1))
      
      // 同步到数据库
      if (newLikeStatus) {
        await likeComment(comment.id, user.id)
      } else {
        await unlikeComment(comment.id, user.id)
      }
      
      // 更新成功后，重新获取最新点赞数（可选）
      const updatedCount = await getCommentLikesCount(comment.id)
      setLikesCount(updatedCount)
      
    } catch (err) {
      console.error("处理评论点赞失败:", err)
      // 发生错误时恢复原状态
      setIsLiked(!isLiked)
      setLikesCount(prev => !isLiked ? prev + 1 : Math.max(0, prev - 1))
    } finally {
      setIsLiking(false)
    }
  }

  // 处理删除评论（本人或管理员）。权限最终由后端 delete_comment 校验，
  // 这里乐观地从列表移除以即时反馈。
  const handleDelete = async () => {
    if (isDeleting) return
    try {
      setIsDeleting(true)
      await deleteComment(comment.id)
      setShowDeleteAlert(false)
      if (onCommentDeleted) onCommentDeleted(comment.id)
      toast({
        title: "已删除",
        description: "评论已删除",
      })
    } catch (err: any) {
      console.error("删除评论失败:", err)
      const msg = err?.message?.includes("权限")
        ? "你没有权限删除此评论"
        : "删除失败，请稍后重试"
      toast({
        title: "删除失败",
        description: msg,
        variant: "destructive",
      })
      setIsDeleting(false)
    }
  }

  return (
    <div className={`p-4 rounded-lg bg-black/20 border border-gray-800/50 ${level > 0 ? "ml-6" : ""}`}>
      <div className="flex gap-3 items-start">
        <button
          type="button"
          onClick={goToProfile}
          aria-label={`查看 ${displayName} 的主页`}
          className="shrink-0"
        >
          <Avatar className="h-8 w-8 avatar-hover-effect cursor-pointer">
            <AvatarImage src={cdnUrl(avatarUrl) || "/logo.png"} />
            <AvatarFallback>{getInitial(displayName)}</AvatarFallback>
          </Avatar>
        </button>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className="font-medium text-gray-200 cursor-pointer hover:text-lime-400 transition-colors"
              onClick={goToProfile}
            >
              {displayName}
            </span>
            <span className="text-xs text-gray-500">{formatDate(comment.created_at)}</span>
          </div>

          <p className="mt-2 text-gray-300 break-all whitespace-pre-wrap">{comment.content}</p>

          <div className="mt-2 flex items-center gap-4">
            <button 
              className={`flex items-center gap-1 text-xs ${isLiked ? 'text-lime-500' : 'text-gray-500 hover:text-lime-500'}`}
              onClick={handleLikeToggle}
              disabled={isLiking || !user || isOptimistic}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              <span>{likesCount}</span>
            </button>

            {canReply && (
              <button
                onClick={() => setShowReplyForm(!showReplyForm)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-lime-500"
              >
                <Reply className="h-3.5 w-3.5" />
                <span>回复</span>
              </button>
            )}

            {canDelete && (
              <button
                onClick={() => setShowDeleteAlert(true)}
                disabled={isDeleting}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400 disabled:opacity-50"
                aria-label="删除评论"
                title={isAdmin && !isAuthor ? "管理员删除" : "删除我的评论"}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>删除</span>
              </button>
            )}
          </div>

          {/* 回复表单 */}
          {showReplyForm && (
            <div className="mt-3">
              <CommentForm
                postId={postId}
                parentId={comment.id}
                isReply
                replyingTo={displayName}
                onCommentAdded={(newReply) => {
                  setShowReplyForm(false)
                  if (onCommentAdded) onCommentAdded(newReply)
                }}
                onCancel={() => setShowReplyForm(false)}
              />
            </div>
          )}

          {/* 渲染子评论/回复 */}
          {comment.replies && comment.replies.length > 0 && (
            <div className="mt-3 space-y-2">
              {comment.replies.map((reply) => (
                <CommentItem
                  key={reply.id}
                  comment={reply}
                  postId={postId}
                  onCommentAdded={onCommentAdded}
                  onCommentDeleted={onCommentDeleted}
                  level={level + 1}
                  isAdmin={isAdmin}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={showDeleteAlert} onOpenChange={setShowDeleteAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              {comment.replies && comment.replies.length > 0
                ? "删除这条评论会同时删除它下面的所有回复，此操作不可撤销。"
                : "确定要删除这条评论吗？此操作不可撤销。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
              disabled={isDeleting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {isDeleting ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
