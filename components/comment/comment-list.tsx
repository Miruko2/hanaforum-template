"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { getComments, addComment, subscribeToCommentsUpdates } from "@/lib/supabase"
import { getCommentsOptimized, addCommentOptimized, subscribeToCommentsOptimized } from "@/lib/supabase-optimized"
import type { Comment } from "@/lib/types"
import CommentItem from "./comment-item"
import CommentForm from "./comment-form"
import { Loader2, Wifi, WifiOff } from "lucide-react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

interface CommentListProps {
  postId: string
  onCommentAdded?: () => void
  isAdmin?: boolean   // 当前用户是否是管理员
}

// 乐观更新的评论类型
interface OptimisticComment extends Comment {
  isOptimistic?: boolean
  tempId?: string
}

// 从评论树中递归移除指定 id 的评论（连同其子树）。
// 后端 delete_comment 会级联删除所有后代回复，这里同步把整棵子树摘掉。
function removeCommentById(list: Comment[], commentId: string): Comment[] {
  return list
    .filter((c) => c.id !== commentId)
    .map((c) =>
      c.replies && c.replies.length > 0
        ? { ...c, replies: removeCommentById(c.replies, commentId) }
        : c,
    )
}

export default function CommentList({
  postId,
  onCommentAdded,
  isAdmin = false
}: CommentListProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [optimisticComments, setOptimisticComments] = useState<OptimisticComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isConnected, setIsConnected] = useState(true)
  const { user } = useSimpleAuth()
  const router = useRouter()
  const subscriptionRef = useRef<(() => void) | null>(null)
  const fetchIdRef = useRef(0)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  
  // 获取评论数据
  const fetchComments = useCallback(async (showLoading = true) => {
    const fetchId = ++fetchIdRef.current
    try {
      if (showLoading) {
        setLoading(true)
      }
      setError(null)
      
      // 添加超时保护
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('获取评论超时')), 8000)
      )
      
      const commentsPromise = getComments(postId)
      const commentsData = await Promise.race([commentsPromise, timeout]) as Comment[]
      
      // 只处理最后一次请求的结果
      if (fetchId === fetchIdRef.current) {
        setComments(commentsData)
        setIsConnected(true)
        // 清除错误状态
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current)
          retryTimeoutRef.current = null
        }
      }
    } catch (err: any) {
      if (fetchId === fetchIdRef.current) {
        console.warn("获取评论失败:", err.message)
        setError("获取评论失败")
        setIsConnected(false)
        
        // 仅在网络错误时自动重试，避免无限重试
        if (err.message.includes('网络') || err.message.includes('超时')) {
          if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current)
          }
          retryTimeoutRef.current = setTimeout(() => {
            fetchComments(false)
          }, 5000) // 增加重试间隔
        }
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false)
      }
    }
  }, [postId])

  // 设置实时订阅
  const setupSubscription = useCallback(() => {
    let isSubscriptionActive = true
    
    const unsubscribe = subscribeToCommentsUpdates(postId, (newComments) => {
      if (!isSubscriptionActive) return
      
      // 智能更新：只有当新数据和当前数据真正不同时才更新
      setComments(prevComments => {
        // 如果数组长度不同，说明有变化
        if (prevComments.length !== newComments.length) {
          return newComments
        }
        
        // 深度比较评论ID和内容
        const prevCommentsMap = new Map(prevComments.map(c => [c.id, c.content]))
        const hasChanges = newComments.some(c => 
          !prevCommentsMap.has(c.id) || prevCommentsMap.get(c.id) !== c.content
        )
        
        return hasChanges ? newComments : prevComments
      })
      
      setIsConnected(true)
      setError(null)
      
      // 更保守的乐观更新清理
      setOptimisticComments(prev => {
        if (prev.length === 0) return prev
        
        const remainingOptimistic = prev.filter(optimisticComment => {
          // 如果是正在发布的评论，保留
          if (optimisticComment.isOptimistic) {
            return true
          }
          
          // 检查是否在新数据中找到匹配的评论
          const foundMatch = newComments.some(realComment => {
            // 更严格的匹配条件
            return realComment.content.trim() === optimisticComment.content.trim() &&
                   realComment.user_id === optimisticComment.user_id &&
                   realComment.post_id === optimisticComment.post_id &&
                   Math.abs(new Date(realComment.created_at).getTime() - new Date(optimisticComment.created_at).getTime()) < 10000
          })
          
          return !foundMatch
        })
        
        return remainingOptimistic
      })
    })
    
    subscriptionRef.current = () => {
      isSubscriptionActive = false
      unsubscribe()
    }
    
    return subscriptionRef.current
  }, [postId])

  // 初始化和订阅管理
  useEffect(() => {
    if (postId) {
      fetchComments()
      const unsubscribe = setupSubscription()
      
      return () => {
        if (unsubscribe) {
          unsubscribe()
        }
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current)
        }
      }
    }
  }, [postId, fetchComments, setupSubscription])

  // 生成临时ID用于乐观更新
  const generateTempId = () => `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  // 处理新评论添加 - 完全无感版本
  const handleCommentAdded = useCallback(async (newComment: Comment | null, content?: string, parentId?: string) => {
    if (!user) return

    if (!newComment && content) {
      // 乐观更新：立即显示评论
      const tempId = generateTempId()
      
      // 正确获取用户名
      const getUserName = () => {
        // 优先从 user_metadata 获取
        if (user.user_metadata?.username) {
          return user.user_metadata.username
        }
        // 如果没有，从 email 生成
        if (user.email) {
          const emailUsername = user.email.split('@')[0]
          return emailUsername
        }
        // 最后的备选方案
        return "我"
      }
      
      const optimisticComment: OptimisticComment = {
        id: tempId,
        tempId,
        user_id: user.id,
        post_id: postId,
        parent_id: parentId || undefined,
        content: content.trim(),
        created_at: new Date().toISOString(),
        username: getUserName(),
        user: {
          id: user.id,
          username: getUserName(),
          avatar_url: user.user_metadata?.avatar_url,
        },
        replies: [],
        likes_count: 0,
        isOptimistic: true,
      }

      // 立即添加到乐观更新列表
      setOptimisticComments(prev => [optimisticComment, ...prev])
      
      // 后台提交真实评论
      try {
        const realComment = await addComment(postId, user.id, content.trim(), parentId)
        
        // 立即将真实评论添加到comments中，确保不会消失
        setComments(prev => {
          // 检查是否已存在该评论（避免重复）
          const exists = prev.some(c => c.id === realComment.id)
          if (exists) {
            return prev
          }
          // 如果是回复，需要更新父评论的replies
          if (parentId) {
            return prev.map(comment => {
              if (comment.id === parentId) {
                return {
                  ...comment,
                  replies: [realComment as Comment, ...(comment.replies || [])]
                }
              }
              return comment
            })
          } else {
            // 主评论直接添加到列表开头
            return [realComment as Comment, ...prev]
          }
        })
        
        // 移除对应的乐观更新评论
        setOptimisticComments(prev => prev.filter(c => c.tempId !== tempId))
        
        // 通知父组件
        if (onCommentAdded) {
          onCommentAdded()
        }
      } catch (error: any) {
        console.error("[评论列表] 后台提交失败:", error)
        // 直接移除乐观更新评论，不显示失败状态
        setOptimisticComments(prev => prev.filter(c => c.tempId !== tempId))
      }
    } else if (newComment) {
      // 真实评论添加成功的回调（通常由实时订阅处理，这里只需通知父组件）
      if (onCommentAdded) {
        onCommentAdded()
      }
    }
  }, [user, postId, onCommentAdded])

  // 处理评论删除：从真实列表与乐观列表中即时移除（后端已删除）
  const handleCommentDeleted = useCallback((commentId: string) => {
    setComments((prev) => removeCommentById(prev, commentId))
    setOptimisticComments((prev) =>
      prev.filter((c) => c.id !== commentId && c.tempId !== commentId),
    )
  }, [])

  // 处理登录按钮点击
  const handleLoginClick = () => {
    router.push("/login")
  }

  // 合并真实评论和乐观更新评论
  const mergedComments = useCallback(() => {
    const allComments = [...optimisticComments, ...comments]
    
    // 更智能的去重和排序
    const commentMap = new Map()
    
    allComments.forEach(comment => {
      const key = (comment as OptimisticComment).tempId || comment.id
      const existing = commentMap.get(key)
      
      if (!existing) {
        // 第一次遇到这个评论，直接添加
        commentMap.set(key, comment)
      } else if (!(comment as OptimisticComment).isOptimistic && (existing as OptimisticComment).isOptimistic) {
        // 如果新评论是真实的，旧评论是乐观的，替换为真实评论
        commentMap.set(key, comment)
      } else if (!existing.id.startsWith('temp_') && comment.id.startsWith('temp_')) {
        // 如果已存在真实评论，忽略临时评论
        // 保持现有的真实评论
      } else if (comment.id && !comment.id.startsWith('temp_')) {
        // 优先保留有真实ID的评论
        commentMap.set(key, comment)
      }
      // 其他情况保持第一个遇到的评论
    })
    
    // 按内容和用户去重（处理可能的重复提交）
    const finalComments = Array.from(commentMap.values())
    const contentMap = new Map()
    
    finalComments.forEach(comment => {
      const contentKey = `${comment.content}-${comment.user_id}-${comment.parent_id || 'root'}`
      const existing = contentMap.get(contentKey)
      
      if (!existing) {
        contentMap.set(contentKey, comment)
      } else if (!comment.id.startsWith('temp_') && existing.id.startsWith('temp_')) {
        // 优先保留真实评论
        contentMap.set(contentKey, comment)
      } else if (!(comment as OptimisticComment).isOptimistic && (existing as OptimisticComment).isOptimistic) {
        // 优先保留非乐观评论
        contentMap.set(contentKey, comment)
      }
    })
    
    return Array.from(contentMap.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  }, [comments, optimisticComments])

  // 计算总评论数（包括回复）
  const countTotalComments = (comments: Comment[]): number => {
    let count = comments.length

    for (const comment of comments) {
      if (comment.replies && comment.replies.length > 0) {
        count += comment.replies.length
      }
    }

    return count
  }

  const displayComments = mergedComments()
  const totalComments = countTotalComments(displayComments) + optimisticComments.filter(c => c.isOptimistic).length

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center">
          评论区
          {!loading && <span className="ml-2 text-sm text-gray-400">({totalComments})</span>}
        </h3>
        
        {/* 连接状态指示器 */}
        <div className="flex items-center gap-2">
          {isConnected ? (
            <div className="flex items-center gap-1 text-xs text-green-400">
              <Wifi className="h-3 w-3" />
              <span>实时</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-xs text-red-400">
              <WifiOff className="h-3 w-3" />
              <span>离线</span>
            </div>
          )}
        </div>
      </div>

      {/* 评论表单 */}
      {user ? (
        <CommentForm
          postId={postId}
          onCommentAdded={handleCommentAdded}
          optimized={true}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-4 space-y-2">
          <p className="text-sm text-gray-400">登录后才能发表评论</p>
          <Button 
            onClick={handleLoginClick}
            variant="outline" 
            size="sm"
            className="bg-lime-500/10 hover:bg-lime-500/20 border-lime-500/30 text-lime-400"
          >
            立即登录
          </Button>
        </div>
      )}

      {/* 评论列表 */}
      <div className="space-y-4">
        {loading && comments.length === 0 && optimisticComments.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 text-lime-500 animate-spin" />
            <span className="ml-2 text-gray-400">加载评论中...</span>
          </div>
        ) : error && comments.length === 0 && optimisticComments.length === 0 ? (
          <div className="p-4 rounded-lg bg-red-900/20 border border-red-900/30">
            <p className="text-red-400 text-sm">{error}</p>
            <Button
              onClick={() => fetchComments()}
              variant="outline"
              className="mt-2 text-xs border-red-900/50 text-red-400 hover:bg-red-900/30"
            >
              重试
            </Button>
          </div>
        ) : comments.length === 0 && optimisticComments.length === 0 ? (
          <div className="p-6 rounded-lg bg-black/20 border border-gray-800/30 text-center">
            <p className="text-gray-400">暂无评论，来发表第一条评论吧！</p>
          </div>
        ) : (
          <>
            {/* 显示乐观更新的评论 */}
            {optimisticComments.map((comment) => (
              <CommentItem
                key={comment.tempId || comment.id}
                comment={comment}
                postId={postId}
                onCommentAdded={handleCommentAdded}
                onCommentDeleted={handleCommentDeleted}
                isOptimistic={true}
                isAdmin={isAdmin}
              />
            ))}
            
            {/* 显示实际评论 */}
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                postId={postId}
                onCommentAdded={handleCommentAdded}
                onCommentDeleted={handleCommentDeleted}
                isAdmin={isAdmin}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
