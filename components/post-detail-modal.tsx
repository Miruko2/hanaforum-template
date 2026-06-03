"use client"

import React, { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, MessageSquare, Pin, PinOff, Maximize2 } from "lucide-react"
import { createPortal } from "react-dom"
import type { Post } from "@/lib/types"
import { Button } from "@/components/ui/button"
import GlassMorph from "./glass-morph"
import PostCardImage from "./post-card-image"
import ImageLightbox from "./image-lightbox"
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
  // 点击详情页图片后，原图在屏幕中心聚焦放大（灯箱）
  const [lightboxOpen, setLightboxOpen] = useState(false)
  // 图片预加载状态：防止灯箱打开时图片未加载导致的闪烁
  const [imagePreloaded, setImagePreloaded] = useState(false)
  const [imageLoading, setImageLoading] = useState(false)

  // 是否使用横版布局：桌面端一律走横版
  // （有图 → 左侧图片；无图 → 左侧 TextualHero 文字大标题）
  const useHorizontalLayout = !isMobile

  // 预加载图片后打开灯箱，避免安卓 WebView 图片闪烁
  const handleOpenLightbox = useCallback(() => {
    if (!post.image_url) return
    
    // 如果已经预加载过，直接打开
    if (imagePreloaded) {
      setLightboxOpen(true)
      return
    }
    
    // 开始加载
    setImageLoading(true)
    const img = new Image()
    img.src = post.image_url
    
    img.onload = () => {
      setImagePreloaded(true)
      setImageLoading(false)
      setLightboxOpen(true)
    }
    
    img.onerror = () => {
      setImageLoading(false)
      // 即使加载失败也尝试打开
      setLightboxOpen(true)
    }
  }, [post.image_url, imagePreloaded])

  // 重置预加载状态（当详情页关闭时）
  React.useEffect(() => {
    if (!isOpen) {
      setImagePreloaded(false)
      setImageLoading(false)
      setLightboxOpen(false)
    }
  }, [isOpen])

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

  // 图片 hover 覆盖层：暗角渐变 + 中心淡入的"放大"图标（磨砂圆）。
  // pointer-events-none 让鼠标穿透到底层图片，hover 由外层 .group 触发；
  // 它是缩放层的兄弟节点，所以图标本身不会跟着图片一起放大。
  const imageHoverOverlay = (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at center, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.5) 100%)",
        }}
      />
      <div className="relative grid h-12 w-12 scale-75 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-md transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-hover:scale-100">
        <Maximize2 className="h-5 w-5" />
      </div>
    </div>
  )

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
        // 手机端正文从 15px 微调到 16.5px (text-[16.5px])，配合更大的 padding
        // 让正文成为视觉焦点；md+ 保持原本的 16px (text-base)
        className="text-gray-200 text-[16.5px] md:text-base leading-relaxed mb-7 whitespace-pre-line"
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
            // 手机端缩到 82vh，让模态框周围露出一圈背景（不再"贴满全屏"），
            // 视觉上更像浮起来的卡片；PC 横版维持 90vh 不变
            style={{ maxHeight: isMobile ? "82vh" : "90vh", zIndex: 41 }}
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
                      <div
                        className="group relative h-full w-full overflow-hidden rounded-t-md md:rounded-l-[24px] md:rounded-tr-none"
                        onClick={handleOpenLightbox}
                      >
                        <div className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.06]">
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
                        </div>
                        {imageHoverOverlay}
                      </div>
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
                <div className="relative flex flex-col">
                  <div className="relative w-full overflow-hidden">
                    {post.image_url ? (
                      <div
                        className="group relative overflow-hidden rounded-t-md"
                        onClick={handleOpenLightbox}
                      >
                        <div className="transition-transform duration-500 ease-out group-hover:scale-[1.06]">
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
                        </div>
                        {imageHoverOverlay}
                      </div>
                    ) : (
                      // 无图帖子：跟 PC 端横版一样走 TextualHero，避免出现孤零零的三角占位
                      // 高度 280px：够展示标题 + 装饰，又不喧宾夺主挤压内容区
                      <div className="h-[280px]">
                        <TextualHero post={post} />
                      </div>
                    )}
                  </div>

                  {/* 手机端内容区：padding 加大 (p-6 → p-7) 让正文有更多呼吸空间；
                      maxHeight 同步调整为 calc(82vh - 280px) 跟新的外层匹配 */}
                  <div className="p-7 overflow-y-auto" style={{ maxHeight: "calc(82vh - 280px)" }}>
                    {contentBody}
                  </div>

                  {/* 图片下缘「分层渐进模糊」带（仅手机竖版）：整条落在图片侧，底边压在
                      「图片 ↔ 卡片」接缝上。放在 flex-col 上、绝对定位，不受图片容器
                      overflow-hidden 裁切。
                      用 4 层叠加（blur 2→5→10→18px），每层用 mask 只显示一段、自上而下错位，
                      叠出真正「上清晰 → 下模糊」的渐进效果（单层 backdrop-filter + mask 在
                      WebView 里只是均匀模糊按透明度淡入，发浑不顺，故拆成多层）。
                      最后叠一层向下压暗的暗影，把图片底缘压到接近暗卡片，淡化接缝硬边。
                      top 依赖详情页竖版图片固定高度 300px（见 PostCardImage 的 h-[300px]）。 */}
                  {post.image_url && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-30"
                      style={{ top: "calc(300px - 88px)", height: "88px" }}
                    >
                      {[
                        { blur: 2, mask: "linear-gradient(to bottom, transparent 0%, #000 35%, #000 55%, transparent 80%)" },
                        { blur: 5, mask: "linear-gradient(to bottom, transparent 25%, #000 50%, #000 72%, transparent 100%)" },
                        { blur: 10, mask: "linear-gradient(to bottom, transparent 48%, #000 72%, #000 100%)" },
                        { blur: 18, mask: "linear-gradient(to bottom, transparent 68%, #000 100%)" },
                      ].map((l, i) => (
                        <div
                          key={i}
                          className="absolute inset-0"
                          style={{
                            backdropFilter: `blur(${l.blur}px)`,
                            WebkitBackdropFilter: `blur(${l.blur}px)`,
                            maskImage: l.mask,
                            WebkitMaskImage: l.mask,
                          }}
                        />
                      ))}
                      {/* 向下压暗的暗影：顶部 30% 不压暗（保持清亮、不在顶端造第二条边），
                          往下逐渐加深，把图片最底缘压到接近暗卡片，淡化接缝 */}
                      <div
                        className="absolute inset-0"
                        style={{
                          background:
                            "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.6) 100%)",
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </GlassMorph>

            {/* 图片灯箱：点击详情页图片后居中聚焦放大（弹跳进出）。
                自带 portal 到 body，盖在详情框之上 */}
            <ImageLightbox
              src={lightboxOpen ? post.image_url ?? null : null}
              alt={post.title}
              onClose={() => setLightboxOpen(false)}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
