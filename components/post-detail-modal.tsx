"use client"

import React, { useState, useCallback } from "react"
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
  // 点击详情页图片后，原图在屏幕中心聚焦放大（灯箱）。加载与弹入时序交给
  // ImageLightbox 自己处理：点击立即打开、先显 loading、原图就绪后再弹入，
  // 故这里不再做阻塞式预加载。
  const [lightboxOpen, setLightboxOpen] = useState(false)

  // 是否使用横版布局：桌面端一律走横版
  // （有图 → 左侧图片；无图 → 左侧 TextualHero 文字大标题）
  const useHorizontalLayout = !isMobile

  // 点击图片：立即打开灯箱，不再阻塞等待原图下载完。原图的加载/解码与弹入时序
  // 由 ImageLightbox 内部处理（先 loading 后弹入），既消除「点了要等一会才出现」，
  // 也避免一边解码大图一边做弹跳动画的卡顿。
  const handleOpenLightbox = useCallback(() => {
    if (!post.image_url) return
    setLightboxOpen(true)
  }, [post.image_url])

  // 详情页关闭时收起灯箱
  React.useEffect(() => {
    if (!isOpen) {
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
          {/* 背景遮罩：固定模糊半径，只用 opacity 淡入。
              原来用 framer-motion 把 backdrop-filter 从 blur(0)→blur(15) 逐帧插值，
              等于每帧把整个全屏背景重做一次高斯模糊 —— 移动端打开卡顿的头号原因。
              改为半径恒定（移动端 10px / 桌面 15px）、整层 opacity 0→1 淡入，
              GPU 只需合成一个已缓存的模糊层，视觉几乎一致、全平台受益。 */}
          <motion.div
            className="absolute inset-0 bg-black/40"
            style={{
              pointerEvents: "none",
              backdropFilter: isMobile ? "blur(10px)" : "blur(15px)",
              WebkitBackdropFilter: isMobile ? "blur(10px)" : "blur(15px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
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
              reduceBlur={isMobile}
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
                      {/* 移动端降级：原 4 层 backdrop-filter 渐进模糊并为 1 层，省 3 层全宽
                          实时高斯模糊。单层用 mask 让模糊自上而下淡入，配合下方暗影过渡
                          「图片 ↔ 卡片」接缝。代价：渐进感略弱，但打开时 GPU 开销大降。 */}
                      <div
                        className="absolute inset-0"
                        style={{
                          backdropFilter: "blur(8px)",
                          WebkitBackdropFilter: "blur(8px)",
                          maskImage:
                            "linear-gradient(to bottom, transparent 0%, #000 55%, #000 100%)",
                          WebkitMaskImage:
                            "linear-gradient(to bottom, transparent 0%, #000 55%, #000 100%)",
                        }}
                      />
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
