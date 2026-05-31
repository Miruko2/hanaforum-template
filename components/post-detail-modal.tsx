"use client"

import React, { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, MessageSquare, Pin, PinOff } from "lucide-react"
import { createPortal } from "react-dom"
import type { Post } from "@/lib/types"
import { Button } from "@/components/ui/button"
import GlassMorph from "./glass-morph"
import PostCardImage from "./post-card-image"
import TextualHero from "./textual-hero"
import CommentList from "./comment/comment-list"
import LikeButton from "./ui/like-button"
import { pinPost, unpinPost } from "@/lib/supabase-optimized"
import { useToast } from "@/hooks/use-toast"
import { CATEGORY_LABELS } from "@/lib/categories"

interface PostDetailModalProps {
  post: Post
  isOpen: boolean
  onClose: () => void
  onLike: (e: React.MouseEvent) => void
  onCommentAdded: () => void
  liked: boolean
  likeCount: number
  isLiking: boolean
  username: string
  avatarUrl?: string | null
  isMobile: boolean
  isAdmin?: boolean
  onPostUpdated?: (postId: string, updates: Partial<Post>) => void
}

export default function PostDetailModal({
  post,
  isOpen,
  onClose,
  onLike,
  onCommentAdded,
  liked,
  likeCount,
  isLiking,
  username,
  avatarUrl,
  isMobile,
  isAdmin = false,
  onPostUpdated,
}: PostDetailModalProps) {
  const { toast } = useToast()
  const [isPinning, setIsPinning] = useState(false)

  // 是否使用横版布局：桌面端一律走横版
  // （有图 → 左侧图片；无图 → 左侧 TextualHero 文字大标题）
  const useHorizontalLayout = !isMobile

  // 置顶帖子处理
  const handlePinPost = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isPinning || !isAdmin) return

    try {
      setIsPinning(true)
      toast({
        title: "处理中",
        description: "正在" + (post.isPinned ? "取消" : "") + "置顶帖子...",
      })

      const success = post.isPinned ? await unpinPost(post.id) : await pinPost(post.id)

      if (success) {
        if (onPostUpdated) {
          onPostUpdated(post.id, { isPinned: !post.isPinned })
        }
        toast({
          title: "操作成功",
          description: post.isPinned ? "帖子已取消置顶" : "帖子已置顶",
        })
      } else {
        throw new Error("操作失败")
      }
    } catch (error) {
      console.error("置顶操作失败:", error)
      toast({
        title: "操作失败",
        description: "置顶操作失败，请稍后重试",
        variant: "destructive",
      })
    } finally {
      setIsPinning(false)
    }
  }

  if (typeof window === "undefined") return null

  // 右侧/下方的内容块：标题、作者、正文、点赞计数、评论
  const contentBody = (
    <>
      {/* Title and category */}
      <motion.div
        className="flex justify-between items-start gap-3 mb-5"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
      >
        <motion.h3
          className="text-2xl md:text-[26px] font-semibold text-white leading-tight"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          {post.title}
        </motion.h3>
        <motion.span
          className="shrink-0 text-white text-sm font-medium px-3 py-1 rounded-full bg-black/25 border border-white/10"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          {CATEGORY_LABELS[post.category] || post.category}
        </motion.span>
      </motion.div>

      {/* Author and date */}
      <motion.div
        className="flex items-center justify-between mb-5 text-sm text-gray-300"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.4 }}
      >
        <div className="flex items-center gap-3">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={username}
              className="w-9 h-9 rounded-full object-cover border border-white/20 avatar-hover-effect"
            />
          ) : (
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-semibold border border-white/20 avatar-hover-effect">
              {username.charAt(0).toUpperCase()}
            </div>
          )}
          <span>{username}</span>
        </div>
        <span className="text-xs">
          {post.created_at ? new Date(post.created_at).toLocaleString("zh-CN") : ""}
        </span>
      </motion.div>

      {/* Post content */}
      <motion.p
        className="text-gray-200 text-[15px] md:text-base leading-relaxed mb-7 whitespace-pre-line"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.5 }}
      >
        {post.description || post.content}
      </motion.p>

      {/* Actions bar */}
      <motion.div
        className="flex justify-between items-center pt-4 border-t border-white/10"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.6 }}
      >
        <div className="flex items-center space-x-4 text-gray-300 text-sm">
          <LikeButton
            liked={liked}
            count={likeCount}
            isLoading={isLiking}
            onClick={onLike}
            size="md"
          />
          <div className="flex items-center space-x-1.5 px-3 py-2 rounded-full">
            <MessageSquare className="h-5 w-5" />
            <span>{post.comments_count || 0}</span>
          </div>
        </div>
      </motion.div>

      {/* Comments */}
      <motion.div
        className="mt-6"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.7 }}
      >
        <CommentList
          postId={post.id}
          onCommentAdded={onCommentAdded}
          isPinned={post.isPinned}
          isAdmin={isAdmin}
        />
      </motion.div>
    </>
  )

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center"
          onClick={onClose}
          initial={{ opacity: 0, pointerEvents: "none" }}
          animate={{ opacity: 1, pointerEvents: "auto" }}
          exit={{ opacity: 0, pointerEvents: "none" }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop with blur */}
          <motion.div
            className="absolute inset-0 backdrop-blur-[15px] bg-black/40"
            initial={{ backdropFilter: "blur(0px)", backgroundColor: "rgba(0,0,0,0)" }}
            animate={{ backdropFilter: "blur(15px)", backgroundColor: "rgba(0,0,0,0.4)" }}
            exit={{ backdropFilter: "blur(0px)", backgroundColor: "rgba(0,0,0,0)" }}
            transition={{ duration: 0.2 }}
            style={{ pointerEvents: "none" }}
          />

          <motion.div
            className={
              useHorizontalLayout
                ? "relative w-full max-w-6xl mx-4 flex flex-col"
                : "relative w-full max-w-4xl mx-4 flex flex-col"
            }
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10, transition: { duration: 0.18, ease: "easeOut" } }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{ maxHeight: "90vh", zIndex: 41 }}
          >
            {/* Close button */}
            <motion.button
              onClick={onClose}
              className="absolute -top-12 right-0 z-10 p-2 text-white hover:text-white/80 transition-colors"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <X className="h-6 w-6" />
            </motion.button>

            {/* Content container with glass effect */}
            <GlassMorph
              className="overflow-hidden"
              dark={true}
              intensity={50}
              animate={true}
              borderGlow={true}
              imageRatio={post.image_ratio}
            >
              {/* 管理员置顶控制按钮 */}
              {isAdmin && (
                <motion.div
                  className="absolute top-4 right-4 z-50"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.4 }}
                >
                  <Button
                    variant={post.isPinned ? "destructive" : "outline"}
                    size="sm"
                    className="flex items-center space-x-1.5 text-xs"
                    onClick={handlePinPost}
                    disabled={isPinning}
                  >
                    {post.isPinned ? (
                      <>
                        <PinOff className="h-3 w-3 mr-1" />
                        取消置顶
                      </>
                    ) : (
                      <>
                        <Pin className="h-3 w-3 mr-1" />
                        置顶帖子
                      </>
                    )}
                  </Button>
                </motion.div>
              )}

              {/* 置顶标记 */}
              {post.isPinned && (
                <motion.div
                  className="absolute top-4 left-0 z-50 bg-red-500 text-white px-3 py-1 rounded-r-md shadow-lg flex items-center"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.4, delay: 0.3 }}
                >
                  <Pin className="h-3.5 w-3.5 mr-1.5" />
                  已置顶
                </motion.div>
              )}

              {useHorizontalLayout ? (
                /* 横版：左图/文字Hero + 右滚动内容，整体高度由外层 maxHeight 控制 */
                <div className="flex flex-row" style={{ height: "min(90vh, 840px)" }}>
                  {/* 左：图片区或文字 Hero，占 45% */}
                  <div className="relative w-[45%] shrink-0 bg-black/20">
                    {post.image_url ? (
                      <PostCardImage
                        post={post}
                        isMobile={isMobile}
                        inDetailView={true}
                        fillParent={true}
                        onImageLoad={(dimensions) => {
                          console.log(
                            `详情视图图片尺寸: ${dimensions.width}x${dimensions.height}, 比例: ${dimensions.ratio}`,
                          )
                        }}
                      />
                    ) : (
                      <TextualHero post={post} />
                    )}
                  </div>

                  {/* 右：滚动内容区，占 55%，与左侧之间用一条细边分隔 */}
                  <div className="flex-1 border-l border-white/10 overflow-y-auto p-6">
                    {contentBody}
                  </div>
                </div>
              ) : (
                /* 竖版：图/文字Hero 在上，文字评论在下（手机端） */
                <div className="flex flex-col">
                  <div className="relative w-full overflow-hidden">
                    {post.image_url ? (
                      <PostCardImage
                        post={post}
                        isMobile={isMobile}
                        inDetailView={true}
                        onImageLoad={(dimensions) => {
                          console.log(
                            `详情视图图片尺寸: ${dimensions.width}x${dimensions.height}, 比例: ${dimensions.ratio}`,
                          )
                        }}
                      />
                    ) : (
                      // 无图帖子：跟 PC 端横版一样走 TextualHero，避免出现孤零零的三角占位
                      // 高度 280px：够展示标题 + 装饰，又不喧宾夺主挤压内容区
                      <div className="h-[280px]">
                        <TextualHero post={post} />
                      </div>
                    )}
                  </div>

                  <div className="p-6 overflow-y-auto" style={{ maxHeight: "calc(90vh - 300px)" }}>
                    {contentBody}
                  </div>
                </div>
              )}
            </GlassMorph>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
