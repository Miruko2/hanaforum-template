"use client"

import React, { useState, useCallback, useLayoutEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, MessageSquare, Maximize2 } from "lucide-react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import type { Post } from "@/lib/types"
import { Button } from "@/components/ui/button"
import GlassMorph from "./glass-morph"
import PostCardImage from "./post-card-image"
import ImageLightbox from "./image-lightbox"
import TextualHero from "./textual-hero"
import CommentList, { prefetchComments } from "./comment/comment-list"
import LikeButton from "./ui/like-button"
import { CATEGORIES } from "@/lib/categories"

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
  /** hero 转场：点击的卡片整卡矩形，开场飞入的放大起点 */
  sourceRect?: DOMRect | null
  /** hero 关闭回飞：卡片图片区矩形，回飞图精准落回这里（与源卡图片像素重合、不跳变） */
  sourceImgRect?: DOMRect | null
  /** hero 转场：列表卡片图已加载的实际 URL（img.currentSrc），飞行图用它即时显示、不闪 */
  sourceSrc?: string | null
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
  sourceRect = null,
  sourceImgRect = null,
  sourceSrc = null,
}: PostDetailModalProps) {
  // 点击详情页图片后，原图在屏幕中心聚焦放大（灯箱）。加载与弹入时序交给
  // ImageLightbox 自己处理：点击立即打开、先显 loading、原图就绪后再弹入，
  // 故这里不再做阻塞式预加载。
  const router = useRouter()

  const [lightboxOpen, setLightboxOpen] = useState(false)

  // 是否使用横版布局：桌面端一律走横版
  // （有图 → 左侧图片；无图 → 左侧 TextualHero 文字大标题）
  const useHorizontalLayout = !isMobile

  // 当前帖子的分类定义（中文名 + 装饰符号），脏数据找不到时徽章回退显示原始值
  const categoryDef = CATEGORIES.find((c) => c.value === post.category)

  // hero 转场（飞行克隆）：用一张独立的、全程不透明的飞行图，从点击卡片图的屏幕矩形
  // （sourceRect）飞到详情图位置（heroRef 测量），到位后交接给详情里的真实图。飞行图在
  // 会淡入的容器之外、全程 opacity:1，所以图是「实体平移放大」而非淡入。纯 transform，
  // 合成器友好、安卓也顺。POC 仅桌面横版启用；竖版（手机）暂走淡入。
  const heroRef = useRef<HTMLDivElement>(null)
  // 这次打开是否走 hero（桌面横版 + 手机竖版都走）：有图 + 拿到源矩形与源图 URL。
  // flyTarget（详情图区）由 heroRef 测量：横版 = 左侧图片列，竖版 = 顶部图片区（同一 ref）。
  const heroActive = !!post.image_url && !!sourceRect && !!sourceSrc
  // 桌面 hero 飞入时模态只做淡入（再叠缩放会和飞入克隆打架、显得乱）；
  // 其余情况（手机、无图帖、源矩形没拿到）模态走「上浮 + 微缩放」进出场，
  // 比纯淡入更有进出感，且纯 transform、合成器友好
  const heroFlight = heroActive && !isMobile
  // 关闭回飞的落点：优先图片区矩形（与源卡图片像素重合、不跳变），回退整卡矩形
  const flyBackTarget = sourceImgRect ?? sourceRect
  // 飞行图飞到目标后置 true → 显示详情真实图、移除飞行图
  const [flyDone, setFlyDone] = useState(false)
  // 飞行目标矩形（详情图位置），由 useLayoutEffect 在 paint 前测量
  const [flyTarget, setFlyTarget] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  // 关闭回飞中：点关闭后先不卸载，让详情图飞回卡片位置，飞到位再真正 onClose
  const [closing, setClosing] = useState(false)
  // 回飞落地只触发一次真正 onClose；exit（淡出揭幕）阶段的 onAnimationComplete 不重复触发
  const closedRef = useRef(false)

  useLayoutEffect(() => {
    if (!isOpen) {
      // 关闭时复位，供下次打开重新计算
      setFlyDone(false)
      setFlyTarget(null)
      setClosing(false)
      return
    }
    if (!heroActive) return
    const el = heroRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    setFlyTarget({ left: r.left, top: r.top, width: r.width, height: r.height })
  }, [isOpen, heroActive])

  // 关闭：hero 模式下先回飞（详情图飞回卡片）再真正关闭；否则直接关闭。
  // 回飞条件：本次走 hero、已飞到位（flyDone）、且拿到起止矩形与图源。
  // 飞到位后由回飞元素的 onAnimationComplete 调用真正的 onClose。
  const handleClose = useCallback(() => {
    // 回飞起点用「关闭瞬间」的详情图矩形重新测量：入场带 y 位移/缩放时，open 时
    // 量到的矩形有偏差，这里重量一次保证回飞图从像素准确的位置起飞
    let target = flyTarget
    const el = heroRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      if (r.width && r.height) {
        target = { left: r.left, top: r.top, width: r.width, height: r.height }
        setFlyTarget(target)
      }
    }
    // 桌面：飞入克隆已飞到位（flyDone）才回飞；手机：飞入是普通淡入（无 flyDone），
    // 只要量到了起止矩形与图源就回飞（飞回动效手机也保留）。
    const canFlyBack = isMobile
      ? !!(heroActive && target && flyBackTarget && sourceSrc)
      : !!(heroActive && flyDone && target && sourceRect && sourceSrc)
    if (canFlyBack) {
      closedRef.current = false
      setClosing(true)
    } else {
      onClose()
    }
  }, [isMobile, heroActive, flyDone, flyTarget, flyBackTarget, sourceRect, sourceSrc, onClose])

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

  // 打开瞬间预取评论：网络请求与入场动画并行，评论区挂载（移动端 350ms 后 /
  // 桌面 hero 飞入后）时数据多半已在缓存 → 直接带内容出现，不闪「加载评论中」。
  // PostCard 入口在 chunk 加载前就预取过了（in-flight 去重、零重复请求），
  // 这里兜住其余入口：个人主页时间线、影院模式、通知铃铛、通知页。
  React.useEffect(() => {
    if (isOpen) prefetchComments(post.id).catch(() => {})
  }, [isOpen, post.id])

  // 手机端：入场动画期间先不挂评论区（CommentList 挂载即拉评论 + 建实时订阅，
  // 是开场最重的主线程活，低端安卓上会和入场动画抢帧）。350ms 后再挂载 ——
  // 此刻入场动画（0.32s）刚收尾，评论区自带 0.4s 淡入接上，肉眼几乎无感。
  // 桌面由 hero 飞入的 flyDone 门控（见下方渲染条件），不走这个计时器。
  const [mobileCommentsReady, setMobileCommentsReady] = useState(false)
  React.useEffect(() => {
    if (!isOpen) {
      setMobileCommentsReady(false)
      return
    }
    if (!isMobile) return
    const t = setTimeout(() => setMobileCommentsReady(true), 350)
    return () => clearTimeout(t)
  }, [isOpen, isMobile])

  // 预热灯箱原图：详情页一打开，就在浏览器空闲时后台预下载原图（post.image_url，
  // 与灯箱用的是同一条直链）。这样首次点击放大可直接命中 HTTP 缓存、无需等待加载
  // ——灯箱内部已有 img.complete 兜底，命中缓存会跳过 loading 直接弹入。
  // 非阻塞：用 requestIdleCallback 让位详情页首屏（小图+评论），不支持时延迟兜底；
  // 详情页关闭时中断尚未完成的预热下载，避免白白占用带宽。
  React.useEffect(() => {
    const url = post.image_url
    if (!isOpen || !url) return

    let img: HTMLImageElement | null = null
    const warm = () => {
      img = new Image()
      img.decoding = "async"
      img.src = url
    }

    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
      cancelIdleCallback?: (id: number) => void
    }
    let idleId: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(warm, { timeout: 1500 })
    } else {
      timer = setTimeout(warm, 400)
    }

    return () => {
      if (idleId != null && typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(idleId)
      if (timer) clearTimeout(timer)
      if (img) img.src = ""
    }
  }, [isOpen, post.image_url])

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
      {/* Title and category —— 内容区 stagger 整体收紧（0.08→0.32s），
          原来延迟一路排到 0.6s，打开后内容「慢半拍」才出现，不跟手 */}
      <motion.div
        className="flex justify-between items-start gap-3 mb-5"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.08 }}
      >
        <motion.h3
          className="text-2xl md:text-[26px] font-semibold text-white leading-tight"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.14 }}
        >
          {post.title}
        </motion.h3>
        <motion.span
          // lime 品牌色玻璃胶囊：淡色底 + 同色描边 + 微辉光，前缀分类装饰符号
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-lime-400/25 bg-lime-400/10 px-3 py-1 text-[13px] font-medium text-lime-300 shadow-[0_0_14px_rgba(163,230,53,0.12),inset_0_1px_0_rgba(255,255,255,0.08)]"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.14 }}
        >
          {categoryDef?.glyph && (
            <span aria-hidden className="text-xs leading-none text-lime-400/90">
              {categoryDef.glyph}
            </span>
          )}
          {categoryDef?.label || post.category}
        </motion.span>
      </motion.div>

      {/* Author and date */}
      <motion.div
        className="flex items-center justify-between mb-5 text-sm text-gray-300"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.2 }}
      >
        <div
          className="flex items-center gap-3 cursor-pointer group/author"
          onClick={() => router.push(`/user?id=${post.user_id}`)}
          title={`查看 ${username} 的主页`}
        >
          <img
            src={avatarUrl || "/logo.png"}
            alt={username}
            className="w-9 h-9 rounded-full object-cover border border-white/20 avatar-hover-effect"
            onError={(e) => {
              // 头像 URL 失效时回退到站点 logo，避免出现裂图
              const img = e.currentTarget
              if (img.src.indexOf("/logo.png") === -1) img.src = "/logo.png"
            }}
          />
          <span className="group-hover/author:text-lime-400 transition-colors">{username}</span>
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
        transition={{ duration: 0.35, delay: 0.26 }}
      >
        {post.description || post.content}
      </motion.p>

      {/* Actions bar */}
      <motion.div
        className="flex justify-between items-center pt-4 border-t border-white/10"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.32 }}
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

      {/* Comments 延迟挂载：CommentList 会拉取评论 + 建实时订阅，是开场最重的主线程活儿。
          桌面：hero 飞入到位（flyDone）再挂载，不和飞入克隆抢主线程；
          手机：入场动画收尾后（mobileCommentsReady，350ms）再挂载，安卓不再开场掉帧。 */}
      {(isMobile ? mobileCommentsReady : !heroActive || flyDone) && (
        <motion.div
          className="mt-6"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <CommentList
            postId={post.id}
            onCommentAdded={onCommentAdded}
            isAdmin={isAdmin}
          />
        </motion.div>
      )}
    </>
  )

  return createPortal(
    <>
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center"
          onClick={handleClose}
          // ⚠️ 这个最外层容器绝不能动画 opacity：它是全屏模糊遮罩和玻璃卡的祖先，
          // 祖先 opacity<1 会让后代的 backdrop-filter 整体失效 —— 表现为开场时
          // 背景先保持清晰、淡入结束瞬间「啪」地糊上；关闭时第一帧背景突然变清晰
          // （= 用户看到的开/关帖「闪动」，安卓上尤其明显）。淡入淡出全部下放给
          // 遮罩层和面板各自完成（参照 notification-bell 同款修复）。
          // pointerEvents 不是 grouping property，瞬时切换、保留无妨。
          initial={{ pointerEvents: "none" as const }}
          animate={{ pointerEvents: "auto" as const }}
          exit={{ pointerEvents: "none" as const }}
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
            animate={{ opacity: closing ? 0 : 1 }}
            exit={{ opacity: 0 }}
            // 回飞关闭时揭幕跟回飞总时长同步推进（揭幕先行一点点），落地时刚好全清：
            // 移动端回飞 0.3s → 揭幕 0.24s；桌面回飞 0.5s → 揭幕 0.35s。
            transition={
              closing
                ? { duration: isMobile ? 0.24 : 0.35, ease: "easeOut" }
                : { duration: 0.2 }
            }
          />

          <motion.div
            className={
              useHorizontalLayout
                ? "relative w-full max-w-6xl mx-4 flex flex-col"
                : "relative w-full max-w-4xl mx-4 flex flex-col"
            }
            onClick={(e) => e.stopPropagation()}
            // 入场「不」在本层动 opacity：本层是 GlassMorph（玻璃卡）的祖先，
            // 祖先 opacity<1 会废掉玻璃卡的 backdrop-filter（结束瞬间突然上玻璃=闪）。
            // 淡入由 GlassMorph 在玻璃元素自身上完成（自带 opacity 0→1，与
            // backdrop-filter 同元素可安全共存）；本层只做纯 transform 的
            // 「上浮 + 微缩放」（transform 不是 grouping property，不破坏后代毛玻璃）。
            // 桌面 hero 飞入时本层完全不动，让「图片从卡片飞入」唱主角。
            // 退出/回飞仍带 opacity：时长很短且面板正在消失，玻璃失效被全屏模糊遮罩盖住。
            initial={heroFlight ? undefined : { y: 18, scale: 0.975 }}
            animate={
              closing
                ? { opacity: 0 }
                : heroFlight
                  ? { opacity: 1 }
                  : { opacity: 1, y: 0, scale: 1 }
            }
            exit={
              heroFlight
                ? { opacity: 0, transition: { duration: 0.18, ease: "easeOut" } }
                : {
                    opacity: 0,
                    y: 10,
                    scale: 0.985,
                    transition: { duration: 0.18, ease: "easeOut" },
                  }
            }
            // 关闭回飞时整框（含底部内容区）「逐渐淡出」，与回飞总时长同步收尾：
            // 移动端 0.3s、桌面 0.5s（0.08 delay + 0.42 飞行）；打开 0.32s 强缓出，上浮收尾轻盈。
            transition={
              closing
                ? { duration: isMobile ? 0.3 : 0.5, ease: "easeOut" }
                : { duration: 0.32, ease: [0.16, 1, 0.3, 1] }
            }
            // 手机端缩到 82vh，让模态框周围露出一圈背景（不再"贴满全屏"），
            // 视觉上更像浮起来的卡片；PC 横版维持 90vh 不变
            style={{ maxHeight: isMobile ? "82vh" : "90vh", zIndex: 41 }}
          >
            {/* Close button（面板容器不再做入场淡入，这里自己淡入；按钮无毛玻璃、安全） */}
            <motion.button
              onClick={handleClose}
              className="absolute -top-12 right-0 z-10 p-2 text-white hover:text-white/80 transition-colors"
              initial={{ opacity: 0 }}
              animate={{ opacity: closing ? 0 : 1 }}
              transition={{ duration: 0.3 }}
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
              {useHorizontalLayout ? (
                /* 横版：左图/文字Hero + 右滚动内容，整体高度由外层 maxHeight 控制 */
                <div className="flex flex-row" style={{ height: "min(90vh, 840px)" }}>
                  {/* 左：图片区或文字 Hero，占 45%。ref 供 hero 转场测量目标矩形。 */}
                  <div ref={heroRef} className="relative w-[45%] shrink-0 bg-black/20">
                    {post.image_url ? (
                      <div
                        className="group relative h-full w-full overflow-hidden rounded-t-md md:rounded-l-[24px] md:rounded-tr-none"
                        onClick={handleOpenLightbox}
                      >
                        <div
                          className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-[1.06]"
                          // hero 飞行期间隐藏真实图，避免和飞行图重叠；飞到位（flyDone）后显示。
                          // 回飞（closing）时同样隐藏，交给回飞图，避免详情图与回飞图重叠。
                          // flyTarget 没量到时不隐藏 → 兜底直接显示真实图，避免「空框先出现」。
                          style={{ opacity: heroActive && flyTarget && (!flyDone || closing) ? 0 : 1 }}
                        >
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
                  <div ref={heroRef} className="relative w-full overflow-hidden">
                    {post.image_url ? (
                      <div
                        className="group relative overflow-hidden rounded-t-md"
                        onClick={handleOpenLightbox}
                      >
                        <div
                          className="transition-transform duration-500 ease-out group-hover:scale-[1.06]"
                          // 竖版（手机）：飞入期间「不」隐藏真实图 —— 详情图是缓存、秒出，作为「目的地兜底」
                          // 始终有图，即便飞行图在手机上偶尔来不及绘制，目的地也绝不空白；飞行图在其上飞入、
                          // 到位即交接。仅在「回飞（closing）」时隐藏真实图，让回飞图独自飞走、不留重影。
                          style={{ opacity: heroActive && closing ? 0 : 1 }}
                        >
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
    </AnimatePresence>

      {/* hero 飞行图：独立于上面会淡入的容器，全程 opacity:1 实体飞入；飞到位后交接给真实图 */}
      <AnimatePresence>
        {isOpen && !isMobile && heroActive && !flyDone && flyTarget && sourceRect && sourceSrc && (
          <motion.div
            key="hero-fly"
            className="fixed z-[50] overflow-hidden pointer-events-none select-none bg-black/20"
            // 用 left/top/width/height 动画（而非 transform scale），让图始终 object-cover
            // 正确填充每一帧的容器尺寸 —— 容器变形时图按比例重新裁剪、不拉伸；底部信息条也
            // 跟着 reflow，文字不变形。代价：单个 fixed 元素每帧 layout，0.42s 一次性、可接受。
            style={{ borderRadius: 14 }}
            initial={{
              left: sourceRect.left,
              top: sourceRect.top,
              width: sourceRect.width,
              height: sourceRect.height,
            }}
            animate={{
              left: flyTarget.left,
              top: flyTarget.top,
              width: flyTarget.width,
              height: flyTarget.height,
            }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            // 飞入用强缓出（近 easeOutExpo）：开头快速冲出、尾部长缓减速到位，放大展开
            // 既有冲击力又丝滑，尾速趋近 0 → 与详情真实图交接更稳。时长 0.6s 增加从容感。
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            onAnimationComplete={() => setFlyDone(true)}
          >
            {/* 整个帖子元素一起飞：图填满。decoding=sync：缓存图同步解码，确保飞行
                第一帧就有图，避免开场主线程繁忙时「空框飞入」。 */}
            <img
              src={sourceSrc}
              alt=""
              draggable={false}
              decoding="sync"
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* 底部信息条：飞行中淡出 → 呼应「整卡移动后底部组件消失、主要放大图片」 */}
            <motion.div
              className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent"
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
            >
              <div className="text-white text-[13px] font-semibold truncate">{post.title}</div>
              <div className="text-white/60 text-[11px] truncate">{username}</div>
            </motion.div>
          </motion.div>
        )}

        {/* hero 回飞图：关闭时详情图从详情位置飞回卡片位置，飞到位后真正 onClose */}
        {closing && flyTarget && flyBackTarget && sourceSrc && (
          <motion.div
            key="hero-fly-back"
            className="fixed z-[50] overflow-hidden pointer-events-none select-none bg-black/20"
            style={{ borderRadius: 14 }}
            initial={{
              left: flyTarget.left,
              top: flyTarget.top,
              width: flyTarget.width,
              height: flyTarget.height,
            }}
            animate={{
              left: flyBackTarget.left,
              top: flyBackTarget.top,
              width: flyBackTarget.width,
              height: flyBackTarget.height,
            }}
            // 飞回用缓入缓出（easeInOutCubic）：轻起 → 加速 → 轻落，收拢有重量感、不会
            // 开头猛缩，尾速趋近 0 → 落回图片区更稳。
            // 移动端：0.3s、无 delay —— 手机上关闭要立等可见地干脆（0.5s 总时长被反馈"不够快"）。
            // 桌面：0.42s + 0.08s delay（先让底部内容区渐隐、图片再起飞），保持从容收拢。
            transition={
              isMobile
                ? { duration: 0.3, ease: [0.65, 0, 0.35, 1] }
                : { duration: 0.42, ease: [0.65, 0, 0.35, 1], delay: 0.08 }
            }
            // 落点 = 源卡图片区（flyBackTarget）：图片在那里 object-cover 的裁剪与源卡图片
            // 完全一致 → 像素级无缝。落地即真正关闭：onClose 让父级 isActive=false（源卡整卡
            // 显形 —— 图片区被回飞图无缝接管、不跳变，下方内容区由 PostCard 做浮现入场）、
            // isOpen=false（useLayoutEffect 复位 closing/flyTarget → 回飞图卸载）。
            // closedRef 保证只触发一次 onClose。
            onAnimationComplete={() => {
              if (closedRef.current) return
              closedRef.current = true
              onClose()
            }}
          >
            <img
              src={sourceSrc}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
            />
            {/* 底部信息条：回飞中淡出 → 落点是图片区（无信息条），与源卡图片严丝合缝对齐 */}
            <motion.div
              className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent"
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <div className="text-white text-[13px] font-semibold truncate">{post.title}</div>
              <div className="text-white/60 text-[11px] truncate">{username}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  )
}
