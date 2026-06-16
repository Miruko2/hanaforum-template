"use client"

import { useState, useCallback, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { addComment } from "@/lib/supabase"
import { addCommentOptimized } from "@/lib/supabase-optimized"
import { Loader2, Send } from "lucide-react"
import type { Comment } from "@/lib/types"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import { StickerPicker } from "@/components/stickers/sticker-picker"
import { makeStickerToken } from "@/lib/stickers"

interface CommentFormProps {
  postId: string
  parentId?: string
  onCommentAdded: (comment: any, content?: string) => void
  onCancel?: () => void
  isReply?: boolean
  replyingTo?: string
  optimized?: boolean // 是否使用优化模式
  // 回复某条「回复」时传入其作者名：提交内容会前置 @提及，使 parent_id 指向顶层主评论后
  // 仍能表达「这条回复是给谁的」。注意与 replyingTo 不同——后者只控制横幅文案，不写进内容。
  mentionTarget?: string
}

export default function CommentForm({
  postId,
  parentId,
  onCommentAdded,
  onCancel,
  isReply = false,
  replyingTo,
  optimized = false,
  mentionTarget,
}: CommentFormProps) {
  const [content, setContent] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { user } = useSimpleAuth()
  const { toast } = useToast()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 在光标处插入表情标记 [s:name]，并把光标移到标记之后
  const insertSticker = useCallback(
    (name: string) => {
      const token = makeStickerToken(name)
      const el = textareaRef.current
      if (!el) {
        setContent((prev) => prev + token)
        return
      }
      const start = el.selectionStart ?? content.length
      const end = el.selectionEnd ?? content.length
      setContent(content.slice(0, start) + token + content.slice(end))
      requestAnimationFrame(() => {
        el.focus()
        const pos = start + token.length
        el.setSelectionRange(pos, pos)
      })
    },
    [content],
  )

  // 处理评论提交 - 静态导出环境优化版本
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      if (!user) {
        toast({
          title: "请先登录",
          description: "发表评论前请先登录账号",
          variant: "destructive",
        })
        return
      }
      
      if (!content.trim()) {
        toast({
          title: "评论内容不能为空",
          variant: "destructive",
        })
        return
      }

      try {
        setIsSubmitting(true)

        // 保存评论内容的副本
        // 若指定了 mentionTarget（回复某条回复时），在内容前前置 @提及，
        // 这样即便 parent_id 指向顶层主评论，接收方也能看到「这条是给我的」。
        const rawContent = content.trim()
        const commentContent = mentionTarget ? `@${mentionTarget} ${rawContent}` : rawContent
        
        // 在静态导出环境下，使用简化的提交流程
        if (optimized) {
          // 优化模式：立即乐观更新UI
          console.log(`[评论表单] 静态导出环境优化模式提交评论`)
          
          // 立即清空输入框
          setContent("")
          
          // 立即通知父组件进行乐观更新
          onCommentAdded(null, commentContent)
          
          // 如果是回复模式，立即关闭回复表单
          if (isReply && onCancel) {
            onCancel()
          }
          
          // 显示加载消息
          toast({
            title: isReply ? "回复成功" : "评论成功",
            description: isReply ? "您的回复已发布" : "您的评论已发布",
          })

          // 后台执行实际的API调用
          try {
            const newComment = optimized 
              ? await addCommentOptimized(postId, user.id, commentContent, parentId)
              : await addComment(postId, user.id, commentContent, parentId)
            
            // 通知父组件真实评论已添加
            onCommentAdded(newComment)
            
            console.log(`[评论表单] 评论提交完全成功，ID: ${newComment.id}`)
            
          } catch (bgError: any) {
            console.error("后台评论提交失败:", bgError)
            // 不再显示错误提示，只记录日志
          }
        } else {
          // 传统模式：等待服务器响应
          console.log(`[评论表单] 静态导出环境传统模式提交评论`)
          
          const newComment = await addComment(postId, user.id, commentContent, parentId)
          
          // 清空输入框
          setContent("")
          
          // 通知父组件
          onCommentAdded(newComment)
          
          // 如果是回复模式，关闭回复表单
          if (isReply && onCancel) {
            onCancel()
          }
          
          toast({
            title: isReply ? "回复成功" : "评论成功",
            description: isReply ? "您的回复已发布" : "您的评论已发布",
          })
        }
      } catch (error: any) {
        console.error(isReply ? "发表回复失败:" : "发表评论失败:", error)
        
        // 静态导出环境下的详细错误处理
        let errorMessage = "发表时出现错误，请稍后重试"
        
        if (error.message?.includes("JWT")) {
          errorMessage = "登录状态已过期，请重新登录"
        } else if (error.message?.includes("RLS")) {
          errorMessage = "没有权限发表评论，请检查登录状态"
        } else if (error.message?.includes("network") || error.message?.includes("fetch")) {
          errorMessage = "网络连接失败，请检查网络后重试"
        }
        
        toast({
          title: isReply ? "回复失败" : "评论失败",
          description: errorMessage,
          variant: "destructive",
        })
      } finally {
        setIsSubmitting(false)
      }
    },
    [user, content, postId, parentId, isReply, onCommentAdded, onCancel, toast, optimized, mentionTarget],
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {isReply && replyingTo && (
        <div className="flex items-center text-xs text-lime-400 mb-1">
          <span>回复给 {replyingTo}</span>
        </div>
      )}

      <Textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={isReply ? `回复 ${replyingTo || ""}...` : "写下你的评论..."}
        className="min-h-[80px] bg-black/30 border-gray-800 focus:border-lime-500/50 text-white focus:ring-lime-500/30 resize-none"
        disabled={isSubmitting}
      />

      <div className="flex items-center justify-between gap-2">
        <StickerPicker onSelect={insertSticker} disabled={isSubmitting} />

        <div className="flex gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
              disabled={isSubmitting}
            >
              取消
            </Button>
          )}

          <Button
            type="submit"
            size="sm"
            className="bg-lime-500 hover:bg-lime-600 text-black"
            disabled={isSubmitting || !content.trim()}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                {optimized ? "发布中..." : "发送中..."}
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5 mr-1" />
                {isReply ? "回复" : "发表评论"}
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  )
}
