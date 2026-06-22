"use client"

import { useState, useEffect, useCallback } from "react"
import { cdnUrl } from "@/lib/cdn-url"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { formatDate, cn } from "@/lib/utils"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { Reply, ThumbsUp, Trash2, ChevronDown, ChevronUp, Bot } from "lucide-react"
import { motion } from "framer-motion"
import type { Comment } from "@/lib/types"
import CommentForm from "./comment-form"
import { StickerText } from "@/components/stickers/sticker-text"
import { checkCommentLiked, likeComment, unlikeComment, getCommentLikesCount, deleteComment } from "@/lib/supabase"
import { supabase } from "@/lib/supabaseClient"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { useMengmegziCommand } from "@/hooks/use-mengmegzi-command"
import DeleteConfirmDialog from "@/components/delete-confirm-dialog"

// 取评论作者展示名（用于 @提及与回复行署名）
function authorNameOf(comment: Comment): string {
  return comment.user?.username || comment.username || "匿名用户"
}

// 拍平回复树（含历史多层嵌套数据）为一条线性列表，供扁平化渲染。
// - 一级回复（直接挂在主评论下）：mentionName 留空。
// - 二级及更深（历史 3 层数据）：mentionName = 其直接父回复的作者名，
//   渲染时前置 @xxx，让用户仍能看到「这条回复是给谁的」。
function flattenReplies(
  replies: Comment[] | undefined,
  parentAuthorName?: string,
): Array<{ reply: Comment; mentionName?: string }> {
  if (!replies || replies.length === 0) return []
  const result: Array<{ reply: Comment; mentionName?: string }> = []
  // 按时间正序（最早在前）：对话从上到下自然阅读。
  // 统一收口后端倒序、历史多层嵌套、乐观 prepend 等多来源造成的顺序不一致。
  const ordered = [...replies].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  for (const reply of ordered) {
    result.push({ reply, mentionName: parentAuthorName })
    if (reply.replies && reply.replies.length > 0) {
      result.push(...flattenReplies(reply.replies, authorNameOf(reply)))
    }
  }
  return result
}

// 轻量回复行：嵌在主评论卡片内部，无独立卡片边框。
function ReplyRow({
  reply,
  mentionName,
  floor,
  postId,
  rootId,
  isAdmin,
  onCommentAdded,
  onCommentDeleted,
}: {
  reply: Comment
  mentionName?: string
  floor?: number
  postId: string
  rootId: string
  isAdmin?: boolean
  onCommentAdded?: (comment: Comment | null) => void
  onCommentDeleted?: (commentId: string) => void
}) {
  const { user } = useSimpleAuth()
  const { toast } = useToast()
  const router = useRouter()
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isLiked, setIsLiked] = useState(false)
  const [likesCount, setLikesCount] = useState(reply.likes_count || reply.likes || 0)
  const [isLiking, setIsLiking] = useState(false)
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const { sending: mmSending, send: mmSend } = useMengmegziCommand()

  const displayName = authorNameOf(reply)
  const avatarUrl = reply.user?.avatar_url || "/logo.png"
  const getInitial = (username?: string) => (username ? username.charAt(0).toUpperCase() : "U")
  const goToProfile = () => router.push(`/user?id=${reply.user_id}`)
  const isAuthor = !!user && user.id === reply.user_id
  const canDelete = isAuthor || isAdmin

  // 管理员一键派萌萌子回复本条回复
  const handleMmReply = async () => {
    const r = await mmSend({ action: "reply_now", comment_id: reply.id })
    toast({ title: r.ok ? "已派萌萌子" : "失败", description: r.message })
  }

  // 点赞状态与计数（与主评论一致逻辑）
  useEffect(() => {
    if (!user) return
    let active = true
    ;(async () => {
      try {
        const liked = await checkCommentLiked(reply.id, user.id)
        if (active) setIsLiked(!!liked)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      active = false
    }
  }, [reply.id, user])

  useEffect(() => {
    const fetchLikesCount = async () => {
      try {
        setLikesCount(await getCommentLikesCount(reply.id))
      } catch {
        /* ignore */
      }
    }
    fetchLikesCount()
    const channel = supabase
      .channel(`comment-likes-${reply.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "comment_likes", filter: `comment_id=eq.${reply.id}` },
        fetchLikesCount,
      )
      .subscribe()
    return () => {
      channel.unsubscribe()
    }
  }, [reply.id])

  const handleLikeToggle = async () => {
    if (!user) {
      toast({ title: "请先登录后再点赞" })
      return
    }
    if (isLiking) return
    try {
      setIsLiking(true)
      const next = !isLiked
      setIsLiked(next)
      setLikesCount((p) => (next ? p + 1 : Math.max(0, p - 1)))
      if (next) await likeComment(reply.id, user.id)
      else await unlikeComment(reply.id, user.id)
      setLikesCount(await getCommentLikesCount(reply.id))
    } catch {
      setIsLiked((v) => !v)
      setLikesCount((p) => (isLiked ? p + 1 : Math.max(0, p - 1)))
    } finally {
      setIsLiking(false)
    }
  }

  const handleDelete = async () => {
    if (isDeleting) return
    try {
      setIsDeleting(true)
      await deleteComment(reply.id)
      setShowDeleteAlert(false)
      onCommentDeleted?.(reply.id)
      toast({ title: "已删除", description: "回复已删除" })
    } catch (err: any) {
      const msg = err?.message?.includes("权限") ? "你没有权限删除此回复" : "删除失败，请稍后重试"
      toast({ title: "删除失败", description: msg, variant: "destructive" })
      setIsDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex gap-2 items-start">
        <button type="button" onClick={goToProfile} className="shrink-0" aria-label={`查看 ${displayName} 的主页`}>
          <Avatar className="h-6 w-6 avatar-hover-effect cursor-pointer">
            <AvatarImage src={cdnUrl(avatarUrl) || "/logo.png"} />
            <AvatarFallback>{getInitial(displayName)}</AvatarFallback>
          </Avatar>
        </button>
        <div className="flex-1 min-w-0">
          {/* 楼中楼回复做成聊天气泡：淡填充 + 描边，靠边线（而非亮度）让轮廓清晰、不刺眼；
              不叠 backdrop-filter（安卓/动画安全）。回退气泡观感只改这一行的 className。 */}
          <div className="rounded-xl bg-white/5 border border-white/10 px-3 py-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="text-xs font-medium text-gray-200 cursor-pointer hover:text-lime-400"
                onClick={goToProfile}
              >
                {displayName}
              </span>
              {mentionName && <span className="text-xs text-gray-500">回复 @{mentionName}</span>}
              <span className="text-[10px] text-gray-600">{formatDate(reply.created_at)}</span>
              {floor != null && (
                <span className="ml-auto shrink-0 font-mono text-[11px] tracking-widest text-white/40">
                  Nº{floor}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-300 break-all whitespace-pre-wrap">
              <StickerText text={reply.content} />
            </p>
            <div className="mt-1.5 flex items-center gap-3">
              <button
                className={`flex items-center gap-1 text-[11px] ${isLiked ? "text-lime-500" : "text-gray-500 hover:text-lime-500"}`}
                onClick={handleLikeToggle}
                disabled={isLiking || !user}
              >
                <ThumbsUp className="h-3 w-3" />
                <span>{likesCount}</span>
              </button>
              <button
                onClick={() => setShowReplyForm((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-lime-500"
              >
                <Reply className="h-3 w-3" />
              </button>
              {isAdmin && (
                <button
                  onClick={handleMmReply}
                  disabled={mmSending}
                  className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-purple-400 disabled:opacity-50"
                  aria-label="让萌萌子回复"
                  title="派萌萌子来回复这条"
                >
                  <Bot className="h-3 w-3" />
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => setShowDeleteAlert(true)}
                  disabled={isDeleting}
                  className="flex items-center text-[11px] text-gray-500 hover:text-red-400 disabled:opacity-50"
                  aria-label="删除回复"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          {showReplyForm && (
            <div className="mt-2">
              <CommentForm
                postId={postId}
                parentId={rootId /* 关键：回复某条回复时 parent_id 仍指向顶层主评论 */}
                isReply
                replyingTo={displayName}
                mentionTarget={displayName /* 内容前置 @displayName */}
                onCommentAdded={(newReply) => {
                  setShowReplyForm(false)
                  onCommentAdded?.(newReply)
                }}
                onCancel={() => setShowReplyForm(false)}
              />
            </div>
          )}
        </div>
      </div>

      <DeleteConfirmDialog
        open={showDeleteAlert}
        onClose={() => setShowDeleteAlert(false)}
        onConfirm={handleDelete}
        loading={isDeleting}
        title={reply.content || "这条回复"}
      />
    </div>
  )
}

export interface CommentItemProps {
  comment: Comment
  postId: string
  onCommentAdded?: (comment: Comment | null) => void
  onCommentDeleted?: (commentId: string) => void
  isOptimistic?: boolean
  isAdmin?: boolean   // 当前用户是否是管理员
  /** 是否「初次加载之后」新增的评论：是则播放淡入+短暂高亮，首批评论静态出现 */
  justAdded?: boolean
}

export default function CommentItem({
  comment,
  postId,
  onCommentAdded,
  onCommentDeleted,
  isOptimistic = false,
  isAdmin = false,
  justAdded = false
}: CommentItemProps) {
  const [showReplyForm, setShowReplyForm] = useState(false)
  const [isLiked, setIsLiked] = useState(false)
  const [likesCount, setLikesCount] = useState(comment.likes_count || comment.likes || 0)
  const [isLiking, setIsLiking] = useState(false)
  const [showDeleteAlert, setShowDeleteAlert] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showAllReplies, setShowAllReplies] = useState(false)
  const { user } = useSimpleAuth()
  const { toast } = useToast()
  const { sending: mmSending, send: mmSend } = useMengmegziCommand()
  const router = useRouter()
  const goToProfile = () => router.push(`/user?id=${comment.user_id}`)

  // 本楼（主评论或任意回复行）发出新回复后：自动展开该楼。
  // 配合「回复按时间正序」——用户刚发的回复排在末尾，realtime 刷回后默认会被
  // slice(0,2) 折进「展开 N 条」里看不到；这里置真，确保自己发的回复立即可见。
  const handleThreadReplyAdded = useCallback(
    (newReply: Comment | null) => {
      setShowAllReplies(true)
      onCommentAdded?.(newReply)
    },
    [onCommentAdded],
  )

  // 管理员一键派萌萌子回复本条评论
  const handleMmReply = async () => {
    const r = await mmSend({ action: "reply_now", comment_id: comment.id })
    toast({ title: r.ok ? "已派萌萌子" : "失败", description: r.message })
  }

  // 是否本人评论；本人或管理员均可删除（非乐观更新中的临时评论）
  const isAuthor = !!user && user.id === comment.user_id
  const canDelete = !isOptimistic && (isAuthor || isAdmin)

  // 获取用户名首字母作为头像备用显示
  const getInitial = (username?: string) => {
    return username ? username.charAt(0).toUpperCase() : "U"
  }

  // 用户名显示逻辑
  const displayName = authorNameOf(comment)

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
    <motion.div
      className="relative overflow-hidden p-4 rounded-lg bg-black/20 border border-gray-800/50 transition-colors duration-200 hover:bg-black/30 hover:border-white/20"
      initial={justAdded ? { opacity: 0, y: 10 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      {justAdded && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 bg-lime-400/10"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.4, ease: "easeOut" }}
        />
      )}
      <div className="relative z-10 flex gap-3 items-start">
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

          <p className="mt-2 text-gray-300 break-all whitespace-pre-wrap">
            <StickerText text={comment.content} />
          </p>

          <div className="mt-2 flex items-center gap-4">
            <button 
              className={`flex items-center gap-1 text-xs ${isLiked ? 'text-lime-500' : 'text-gray-500 hover:text-lime-500'}`}
              onClick={handleLikeToggle}
              disabled={isLiking || !user || isOptimistic}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
              <span>{likesCount}</span>
            </button>

            <button
              onClick={() => setShowReplyForm(!showReplyForm)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-lime-500"
            >
              <Reply className="h-3.5 w-3.5" />
              <span>回复</span>
            </button>

            {isAdmin && (
              <button
                onClick={handleMmReply}
                disabled={mmSending}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-purple-400 disabled:opacity-50"
                aria-label="让萌萌子回复"
                title="派萌萌子来回复这条评论"
              >
                <Bot className="h-3.5 w-3.5" />
                <span>萌萌子回复</span>
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
                  handleThreadReplyAdded(newReply)
                }}
                onCancel={() => setShowReplyForm(false)}
              />
            </div>
          )}

          {/* 扁平化渲染所有回复（含历史多层嵌套数据，统一拍平挂在本卡片下）。
              默认只展示 2 条，其余收进「展开 N 条回复」，避免回复过多时滚不到下一条主评论。 */}
          {(() => {
            const flatReplies = flattenReplies(comment.replies)
            if (flatReplies.length === 0) return null
            const visibleReplies = showAllReplies ? flatReplies : flatReplies.slice(0, 2)
            const hiddenCount = flatReplies.length - 2
            return (
              <div className="mt-3 space-y-2">
                {visibleReplies.map(({ reply, mentionName }, i) => (
                  <ReplyRow
                    key={reply.id}
                    reply={reply}
                    mentionName={mentionName}
                    floor={i + 1}
                    postId={postId}
                    rootId={comment.id /* 回复行的回复一律挂到顶层主评论 */}
                    isAdmin={isAdmin}
                    onCommentAdded={handleThreadReplyAdded}
                    onCommentDeleted={onCommentDeleted}
                  />
                ))}
                {!showAllReplies && hiddenCount > 0 && (
                  <button
                    onClick={() => setShowAllReplies(true)}
                    className="mt-1 flex items-center gap-1 text-[11px] text-gray-400 hover:text-lime-400"
                  >
                    <ChevronDown className="h-3 w-3" />
                    <span>展开 {hiddenCount} 条回复</span>
                  </button>
                )}
                {showAllReplies && flatReplies.length > 2 && (
                  <button
                    onClick={() => setShowAllReplies(false)}
                    className="mt-1 flex items-center gap-1 text-[11px] text-gray-400 hover:text-lime-400"
                  >
                    <ChevronUp className="h-3 w-3" />
                    <span>收起</span>
                  </button>
                )}
              </div>
            )
          })()}
        </div>
      </div>

      <DeleteConfirmDialog
        open={showDeleteAlert}
        onClose={() => setShowDeleteAlert(false)}
        onConfirm={handleDelete}
        loading={isDeleting}
        title={comment.content || "这条评论"}
      />
    </motion.div>
  )
}
