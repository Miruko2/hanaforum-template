"use client"

import React, { useState, useCallback, useLayoutEffect, useRef } from "react"
import { cdnUrl } from "@/lib/cdn-url"
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from "framer-motion"
import { X, MessageSquare, Maximize2, Bot, EyeOff, Eye } from "lucide-react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import type { Post } from "@/lib/types"
import { Button } from "@/components/ui/button"
import GlassMorph from "./glass-morph"
import PostCardImage from "./post-card-image"
import PostImageCarousel from "./post-image-carousel"
import MusicDetailPlayer from "./music-detail-player"
import ImageLightbox from "./image-lightbox"
import TextualHero from "./textual-hero"
import CommentList, { prefetchComments } from "./comment/comment-list"
import { StickerText } from "@/components/stickers/sticker-text"
import LikeButton from "./ui/like-button"
import CollectButton from "./ui/collect-button"
import { CATEGORIES } from "@/lib/categories"
import { postImageList } from "@/lib/post-images"
import { useMengmegziCommand } from "@/hooks/use-mengmegzi-command"
import { useToast } from "@/hooks/use-toast"
import ShareButton from "@/components/share/share-button"
import { SITE_URL } from "@/lib/site-url"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"

// 安卓（含 Capacitor WebView）：合成器对 backdrop-filter 的逐帧重采样远弱于
// iOS/桌面，开/关帖动画期间的玻璃面板与渐进模糊带在安卓上降级（实底/纯渐变）。
// 必须模块级同步取值（不能用 effect 异步置位的 hook）：驱动 framer-motion
// initial/样式分支的平台判定若首帧后才翻转，会造成初始状态错位（music 覆盖层踩过）。
const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)
// iOS（含 iPadOS 桌面化 UA：MacIntel + 多点触控）：overflow:hidden 锁不住触摸滚动，
// 锁滚动时需额外用 position:fixed 把文档塌缩（见下方滚动锁 effect）。
const IS_IOS =
  typeof navigator !== "undefined" &&
  (/iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))

interface PostDetailModalProps {
  post: Post
  isOpen: boolean
  onClose: () => void
  onLike: (e: React.MouseEvent) => void
  onCommentAdded: () => void
  liked: boolean
  likeCount: number
  isLiking: boolean
  /** 收藏（可选）：从信息流卡片打开时传入；其它入口（通知/公告）未传则不显示收藏按钮 */
  collected?: boolean
  isCollecting?: boolean
  onCollect?: (e: React.MouseEvent) => void
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
  collected = false,
  isCollecting = false,
  onCollect,
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
  const { sending: mmSending, send: mmSend } = useMengmegziCommand()
  const { toast } = useToast()

  // 管理员一键派萌萌子来本帖留言
  const handleMmComment = async () => {
    const r = await mmSend({ action: "comment_now", post_id: post.id })
    toast({ title: r.ok ? "已派萌萌子" : "失败", description: r.message })
  }

  // 管理员一键标记/取消「敏感内容」(is_nsfw)：被标记的帖子在首页封面会隐藏为模糊警告占位。
  // 详情页仍显示原图（用户点进来就是想看），这里只是切换标记并同步回首页列表(updatePost)。
  const [nsfwToggling, setNsfwToggling] = useState(false)
  const handleToggleNsfw = async () => {
    if (nsfwToggling) return
    setNsfwToggling(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) {
        toast({ title: "未登录", description: "请重新登录后再试", variant: "destructive" })
        return
      }
      const next = !post.is_nsfw
      const res = await fetch(apiUrl("/api/admin/post-nsfw"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ postId: post.id, isNsfw: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "操作失败", description: data?.error || `HTTP ${res.status}`, variant: "destructive" })
        return
      }
      onPostUpdated?.(post.id, { is_nsfw: next })
      toast({
        title: next ? "已标记为敏感" : "已取消敏感标记",
        description: next ? "首页封面已隐藏为模糊警告" : "首页封面已恢复显示",
      })
    } catch (err: any) {
      toast({ title: "操作失败", description: err?.message || "网络错误", variant: "destructive" })
    } finally {
      setNsfwToggling(false)
    }
  }

  const [lightboxOpen, setLightboxOpen] = useState(false)
  // 多图：详情页轮播当前页 / 灯箱起始页（两者共享，点开即看同一张）
  const [imageIndex, setImageIndex] = useState(0)
  // 上一帧 lightboxOpen，用于侦测「关灯箱」这一跳变 → 触发详情图淡入遮掩重绘（见下方 effect）
  const prevLightboxOpenRef = useRef(false)
  // 评论区容器：点顶部「评论计数」时平滑滚到这里（scrollIntoView 自动找最近的滚动祖先，
  // 横版=右侧内容列、竖版=外层滚动容器，两种布局都对）
  const commentsRef = useRef<HTMLDivElement>(null)

  // 帖子全部图片（封面在首位）。单图老帖回退 [image_url]。
  const images = postImageList(post)
  const hasMultipleImages = images.length > 1

  // 是否使用横版布局：桌面端一律走横版
  // （有图 → 左侧图片；无图 → 左侧 TextualHero 文字大标题）
  const useHorizontalLayout = !isMobile

  // 当前帖子的分类定义（中文名 + 装饰符号），脏数据找不到时徽章回退显示原始值
  const categoryDef = CATEGORIES.find((c) => c.value === post.category)

  // 短帖（正文很短）：右侧内容上半部分会显空，收紧标题/作者/正文之间的间距，
  // 让操作条与评论区上移、减少大段留白；长帖维持原本舒展的节奏。
  const isShortPost = (post.description || post.content || "").trim().length <= 40

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
  // 回飞图源的自然宽高比（naturalWidth/naturalHeight），关闭瞬间从详情图元素读取。
  // FlyBackImage 用它按 object-cover 公式精确算起点缩放，保证回飞首帧与详情图像素一致。
  const flyImgRatioRef = useRef<number | null>(null)

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
      // 顺手读详情图的自然宽高比，供回飞图精确复刻 object-cover 裁剪
      const imgEl = el.querySelector("img")
      flyImgRatioRef.current =
        imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0
          ? imgEl.naturalWidth / imgEl.naturalHeight
          : null
    }
    // 桌面：飞入克隆已飞到位（flyDone）才回飞；手机：飞入是普通淡入（无 flyDone），
    // 只要量到了起止矩形与图源就回飞（飞回动效手机也保留）。
    // 手机整页滚动后，图片可能已滚出顶部视野 —— 此时回飞起点会是屏幕外的负 top，
    // 图片会「从屏幕上方瞬移飞回卡片」很突兀。故手机上若图已大幅滚出视野（顶部可见
    // 部分不足一半），放弃回飞、走普通淡出关闭，更自然。
    const mobileImageScrolledAway = (() => {
      if (!isMobile || !el) return false
      const r = el.getBoundingClientRect()
      // r.bottom < 0 = 图完全滚出顶部；r.top + r.height/2 < 0 = 超过一半已滚出
      return r.height > 0 && r.top + r.height / 2 < 0
    })()
    const canFlyBack = isMobile
      ? !!(heroActive && target && flyBackTarget && sourceSrc) && !mobileImageScrolledAway
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
      setImageIndex(0)
    }
  }, [isOpen])

  // 安卓：关灯箱瞬间，给详情图区做一次快速淡入，把「图层揭开时的重绘」藏进淡入里。
  // 残留根因：详情大图被全屏灯箱遮挡期间纹理被 WebView 丢弃，关灯箱揭开时冷重栅格 → 轻微抖动/闪。
  // 对被遮挡层「保活」无效（已证伪）；改为「接受重绘但用 opacity 遮掩」——重绘发生在 opacity≈0
  // 的首帧（不可见），随后淡到 1 时位图已栅格完成（已暖）。用 WAAPI 一次性播放、fill 默认不持久
  // （结束自动回到 style 的 opacity:1），不影响 hero 转场对 heroRef 的测量。时长与灯箱 exit(0.25s)
  // 同步：两者都由 lightboxOpen→false 触发，淡入与遮罩退场齐步，揭开即暖。仅安卓（桌面/iOS 无此问题）。
  React.useEffect(() => {
    const justClosed = prevLightboxOpenRef.current && !lightboxOpen
    prevLightboxOpenRef.current = lightboxOpen
    if (!justClosed || !IS_ANDROID) return
    const el = heroRef.current
    if (el && typeof el.animate === "function") {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: "ease-out" })
    }
  }, [lightboxOpen])

  // 打开瞬间预取评论：网络请求与入场动画并行，评论区挂载（移动端 350ms 后 /
  // 桌面 hero 飞入后）时数据多半已在缓存 → 直接带内容出现，不闪「加载评论中」。
  // PostCard 入口在 chunk 加载前就预取过了（in-flight 去重、零重复请求），
  // 这里兜住其余入口：个人主页时间线、影院模式、通知铃铛、通知页。
  React.useEffect(() => {
    if (isOpen) prefetchComments(post.id).catch(() => {})
  }, [isOpen, post.id])

  // 手机端评论区改为打开即挂载（不再延迟 350ms）：之前延迟挂载会让卡片先以
  // 「无评论区」的矮高度出现，350ms 后评论区带缓存内容挂上、高度猛地撑高，
  // 视觉上就是「帖子先矮后突兀拔高」。打开即挂载后高度一开始就完整，评论区
  // 自带的 0.4s 淡入是 opacity/位移动画、不影响布局高度，所以不会再跳高。

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

  // 打开详情时锁住背景滚动 —— 统一在弹窗本体处理，覆盖所有入口（信息流卡片 / 个人主页时间线 /
  // 影院模式 / 通知 / 公告 / 集邮册），免去每个入口各自维护、各自漏掉（漏掉就是「打开详情后
  // 上下滚动整页跟着滚」那个 bug）。
  // ⚠️ 必须同时锁 <html> 和 <body>：本站 body 设了 overflow-x:hidden，垂直滚动条因此落到
  // documentElement(<html>) 上，只锁 body 拦不住 —— 弹窗内滚轮会带动背后整页一起滚。
  // iOS Safari 的 overflow:hidden 锁不住触摸滚动，额外用 position:fixed + top:-scrollY 把文档塌缩、
  // 关闭再 scrollTo 回原位；这套 fixed hack 只给 iOS，安卓/桌面纯 overflow:hidden（避免整页 reflow
  // 触发开/关帖闪动）。
  // 保存并还原「打开前的原值」而非硬清空：集邮册弹窗会在自己已锁页面时再开本详情弹窗，嵌套关闭
  // 内层必须还原成外层的锁定值、而非直接解锁，否则内层一关、外层背景就又能滚了。
  React.useEffect(() => {
    if (!isOpen) return
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0
    const html = document.documentElement.style
    const body = document.body.style
    const fixedLock = isMobile && IS_IOS
    const prev = {
      htmlOverflow: html.overflow,
      bodyOverflow: body.overflow,
      bodyPosition: body.position,
      bodyWidth: body.width,
      bodyTop: body.top,
    }
    html.overflow = "hidden"
    body.overflow = "hidden"
    if (fixedLock) {
      body.position = "fixed"
      body.width = "100%"
      body.top = `-${scrollY}px`
    }
    return () => {
      html.overflow = prev.htmlOverflow
      body.overflow = prev.bodyOverflow
      if (fixedLock) {
        body.position = prev.bodyPosition
        body.width = prev.bodyWidth
        body.top = prev.bodyTop
        window.scrollTo({ top: scrollY, behavior: "auto" })
      }
    }
  }, [isOpen, isMobile])

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
        className={`flex justify-between items-start gap-3 ${isShortPost ? "mb-3" : "mb-5"}`}
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
        className={`flex items-center justify-between ${isShortPost ? "mb-3" : "mb-5"} text-sm text-gray-300`}
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
            src={cdnUrl(avatarUrl) || "/logo.png"}
            alt={username}
            className="w-9 h-9 rounded-full object-cover border border-white/20 avatar-hover-effect"
            onError={(e) => {
              // 头像 URL 失效时回退到站点 logo，避免出现裂图
              const img = e.currentTarget
              if (img.src.indexOf("/logo.png") === -1) img.src = "/logo.png"
            }}
          />
          <span className="font-medium text-gray-100 group-hover/author:text-lime-400 transition-colors">{username}</span>
        </div>
        <span className="text-xs">
          {post.created_at ? new Date(post.created_at).toLocaleString("zh-CN") : ""}
        </span>
      </motion.div>

      {/* Post content */}
      <motion.p
        // 手机端正文从 15px 微调到 16.5px (text-[16.5px])，配合更大的 padding
        // 让正文成为视觉焦点；md+ 保持原本的 16px (text-base)
        className={`text-gray-200 text-[16.5px] md:text-base leading-relaxed ${isShortPost ? "mb-4" : "mb-7"} whitespace-pre-line`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.26 }}
      >
        <StickerText text={post.description || post.content} />
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
          <button
            type="button"
            onClick={() => commentsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="跳到评论区"
          >
            <MessageSquare className="h-5 w-5" />
            <span>{post.comments_count || 0}</span>
          </button>
          {/* 收藏：仅从信息流卡片打开详情时显示（onCollect 存在）；私密开关、不带数字 */}
          {onCollect && (
            <CollectButton
              collected={collected}
              isLoading={isCollecting}
              onClick={onCollect}
              size="md"
            />
          )}
        </div>
        {/* 分享：生成带二维码的精美海报，保存后发微信/QQ */}
        <ShareButton
          variant="pill"
          input={{
            kind: "post",
            title: post.title,
            content: post.description || post.content,
            author: username,
            avatarUrl,
            imageUrl: post.image_url,
            url: SITE_URL,
          }}
        />
      </motion.div>

      {/* Comments 挂载时机：
          手机：打开即挂载，卡片高度一开始就完整，避免「先矮后拔高」；
          桌面：hero 飞入到位（flyDone）再挂载，不和飞入克隆抢主线程。 */}
      {(isMobile || !heroActive || flyDone) && (
        <motion.div
          ref={commentsRef}
          className="mt-6 scroll-mt-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* 管理员操作：派萌萌子留言 / 标记(取消)敏感内容 */}
          {isAdmin && (
            <div className="mb-3 flex flex-wrap justify-end gap-2">
              <button
                onClick={handleMmComment}
                disabled={mmSending}
                className="flex items-center gap-1.5 rounded-full border border-purple-400/25 bg-purple-500/10 px-3 py-1 text-[13px] font-medium text-purple-300 shadow-[0_0_14px_rgba(168,85,247,0.12),inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:bg-purple-500/20 disabled:opacity-50"
                title="派萌萌子来这个帖子留言"
              >
                <Bot className="h-3.5 w-3.5" />
                {mmSending ? "派发中..." : "萌萌子留言"}
              </button>
              <button
                onClick={handleToggleNsfw}
                disabled={nsfwToggling}
                className={
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium shadow-[0_0_14px_rgba(245,158,11,0.12),inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors disabled:opacity-50 " +
                  (post.is_nsfw
                    ? "border-amber-400/30 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                    : "border-amber-400/25 bg-amber-500/10 text-amber-200/90 hover:bg-amber-500/20")
                }
                title={post.is_nsfw ? "取消敏感标记，首页封面恢复显示" : "标记为敏感，首页封面隐藏为模糊警告"}
              >
                {post.is_nsfw ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                {nsfwToggling ? "处理中..." : post.is_nsfw ? "取消敏感标记" : "标记为敏感"}
              </button>
            </div>
          )}
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
              GPU 只需合成一个已缓存的模糊层，视觉几乎一致、全平台受益。
              安卓降级实底（与 GlassMorph 的 solid={IS_ANDROID} 一致）：灯箱是 portal 到
              body 的全屏 fixed 层、盖在本遮罩之上，灯箱遮罩做 opacity 进出场时本层
              backdrop-filter 会被迫每帧重采样（上面盖的半透明层在变），安卓 WebView
              合成器撕裂 → 灯箱开/关闪屏。去 backdrop-filter 后本层是纯实底合成、不重采样，
              灯箱开关不再触发底下撕裂。底下已有 bg-black/40，实底观感差异极小。
              ⚠️ 安卓再进一步「实底不透明」(非 0.40 半透明)：「关灯箱时帖子以外闪」的根因是
              本遮罩半透明 → 背后整屏论坛网格(一堆卡片大图,复杂层)透出;灯箱全屏遮挡期间该网格
              纹理被 WebView 丢弃,关灯箱揭开时冷重栅格整屏 → 撕裂(对被遮挡的复杂层做「保活」无效,
              已验证)。改不透明后:① 模态期间论坛网格被完全挡住,关灯箱只揭开「本纯色遮罩」(重栅格
              平凡、不撕裂);② 论坛网格只在「关详情页」时才露出,而那时有 hero 回飞动画掩护、不显眼。
              代价:安卓详情页四周从「暗淡透出网格」变「纯深色」——安卓本就无毛玻璃模糊,观感更干净。
              桌面/iOS 维持 0.40+模糊不变(WebKit 合成器无此问题)。 */}
          <motion.div
            className={`absolute inset-0 ${IS_ANDROID ? "bg-[#0a0a0e]" : "bg-black/40"}`}
            style={{
              pointerEvents: "none",
              backdropFilter: IS_ANDROID ? undefined : isMobile ? "blur(10px)" : "blur(15px)",
              WebkitBackdropFilter: IS_ANDROID ? undefined : isMobile ? "blur(10px)" : "blur(15px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: closing ? 0 : 1 }}
            exit={{ opacity: 0 }}
            // 回飞关闭时揭幕跟回飞总时长同步推进（揭幕先行一点点），落地时刚好全清：
            // 移动端回飞 0.18s → 揭幕 0.15s；桌面回飞 0.3s → 揭幕 0.22s。
            transition={
              closing
                ? { duration: isMobile ? 0.15 : 0.22, ease: "easeOut" }
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
            // 移动端 0.18s、桌面 0.3s（0.04 delay + 0.26 飞行）；打开 0.32s 强缓出，上浮收尾轻盈。
            transition={
              closing
                ? { duration: isMobile ? 0.18 : 0.3, ease: "easeOut" }
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
              // 安卓：面板实底化（去 backdrop-filter）。底下已有全屏 blur(10px) 遮罩，
              // 毛玻璃采样的本来就是模糊画面、观感几乎一致；而面板「上浮+微缩放」入场
              // 从每帧重采样背景变成纯合成 —— 安卓开/关帖掉帧的主因之一。
              solid={IS_ANDROID}
            >
              {useHorizontalLayout ? (
                /* 横版：左图/文字Hero + 右滚动内容，整体高度由外层 maxHeight 控制 */
                <div className="flex flex-row" style={{ height: "min(90vh, 840px)" }}>
                  {/* 左：图片区或文字 Hero，占 45%。ref 供 hero 转场测量目标矩形。 */}
                  <div ref={heroRef} className="relative w-[45%] shrink-0 bg-black/20">
                    {post.image_url ? (
                      hasMultipleImages ? (
                        // 多图：轮播（飞入期间隐藏，交接给飞行图）
                        <div
                          className="relative h-full w-full overflow-hidden rounded-t-md md:rounded-l-[24px] md:rounded-tr-none"
                          style={{ opacity: heroActive && flyTarget && (!flyDone || closing) ? 0 : 1 }}
                        >
                          <PostImageCarousel
                            images={images}
                            alt={post.title}
                            fillParent
                            fullRes
                            onIndexChange={setImageIndex}
                            onImageClick={(i) => {
                              setImageIndex(i)
                              setLightboxOpen(true)
                            }}
                          />
                        </div>
                      ) : (
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
                              fullRes
                            />
                          </div>
                          {imageHoverOverlay}
                        </div>
                      )
                    ) : post.music ? (
                      <MusicDetailPlayer post={post} />
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
                /* 竖版：图 + 内容在同一个滚动容器里（手机端），整体上下滚动。
                   —— 图片不再钉死顶部：滚下去时图片随之滚出视野，给内容让出全部空间，
                   解决「图片一直显示影响可读性」。
                   1) 单一滚动容器（overflow-y-auto + max-h-[82vh]）：图、模糊带、内容
                      全在里面一起滚。GlassMorph 子容器不继承外层 maxHeight，故限高挂这里。
                   2) 图片高度由 PostCardImage 的 inDetailView 分支用「单一 aspect-ratio」撑出，
                      absolute img 准确填满、不露白。
                   3) 渐进模糊带做成内容顶部的「贴纸块」(absolute 在内容 wrapper 顶)，
                      随滚动上移、最后压在图底↔内容顶的接缝处淡出。
                   4) heroRef 仍挂在图容器上：handleClose 关闭时会重新 getBoundingClientRect，
                      容器随滚动位移，量到的就是当前真实屏幕矩形，回飞起点仍准确。 */
                <div
                  className="relative max-h-[82vh] overflow-y-auto"
                  style={{
                    WebkitOverflowScrolling: "touch",
                    overscrollBehavior: "contain",
                  }}
                >
                  {/* 图片区：随滚动上移，滚出顶部即消失 */}
                  <div ref={heroRef} className="relative w-full overflow-hidden">
                    {post.image_url ? (
                      hasMultipleImages ? (
                        // 多图（手机竖版）：轮播。飞入期间不隐藏（详情图缓存秒出做兜底），仅回飞时隐藏。
                        <div
                          className="relative overflow-hidden rounded-t-md"
                          style={{ opacity: heroActive && closing ? 0 : 1 }}
                        >
                          <PostImageCarousel
                            images={images}
                            alt={post.title}
                            fullRes
                            onIndexChange={setImageIndex}
                            onImageClick={(i) => {
                              setImageIndex(i)
                              setLightboxOpen(true)
                            }}
                          />
                        </div>
                      ) : (
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
                            fullRes
                          />
                        </div>
                          {imageHoverOverlay}
                        </div>
                      )
                    ) : post.music ? (
                      // 音乐帖（手机竖版）：音乐播放块。高度给足，封面 + 播放 + 进度条不挤压。
                      <div className="min-h-[340px]">
                        <MusicDetailPlayer post={post} />
                      </div>
                    ) : (
                      // 无图帖子：跟 PC 端横版一样走 TextualHero，避免出现孤零零的三角占位
                      // 高度 280px：够展示标题 + 装饰，又不喧宾夺主挤压内容区
                      <div className="h-[280px]">
                        <TextualHero post={post} />
                      </div>
                    )}
                  </div>

                  {/* 内容区：整块随外层滚动容器上下滚动 → 图片随之滚出视野。
                      图片↔内容之间不再加模糊/暗影过渡带（整页滚动后它的定位会跟着内容
                      上移，悬在半空很难看），改为图片直接接内容、由内容自身的不透明
                      背景自然遮挡图底。 */}
                  <div className="relative z-20 p-7">
                    {contentBody}
                  </div>
                </div>
              )}
            </GlassMorph>

            {/* 图片灯箱：点击详情页图片后居中聚焦放大；多图可左右滑动 + 圆点指示。
                自带 portal 到 body，盖在详情框之上 */}
            <ImageLightbox
              images={lightboxOpen ? images.map((u) => cdnUrl(u) || u) : null}
              maskSrc={
                lightboxOpen && images.length === 1 && post.image_mask_url
                  ? cdnUrl(post.image_mask_url) || post.image_mask_url
                  : null
              }
              index={imageIndex}
              onIndexChange={setImageIndex}
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

        {/* hero 回飞图：关闭时详情图从详情位置飞回卡片位置，飞到位后真正 onClose。
            纯 transform 的 FLIP 实现（见 FlyBackImage）—— 旧版动画 left/top/width/height
            每帧触发 layout + 整图重栅格化，是安卓关帖掉帧主因。
            落点 = 源卡图片区（flyBackTarget）：图片在那里 object-cover 的裁剪与源卡图片
            完全一致 → 像素级无缝。落地即真正关闭：onClose 让父级 isActive=false（源卡整卡
            显形 —— 图片区被回飞图无缝接管、不跳变，下方内容区由 PostCard 做浮现入场）、
            isOpen=false（useLayoutEffect 复位 closing/flyTarget → 回飞图卸载）。
            closedRef 保证只触发一次 onClose。 */}
        {closing && flyTarget && flyBackTarget && sourceSrc && (
          <FlyBackImage
            key="hero-fly-back"
            from={flyTarget}
            to={{
              left: flyBackTarget.left,
              top: flyBackTarget.top,
              width: flyBackTarget.width,
              height: flyBackTarget.height,
            }}
            src={sourceSrc}
            imgRatio={flyImgRatioRef.current}
            isMobile={isMobile}
            title={post.title}
            username={username}
            onArrive={() => {
              if (closedRef.current) return
              closedRef.current = true
              onClose()
            }}
          />
        )}
      </AnimatePresence>
    </>,
    document.body,
  )
}

type FlyRect = { left: number; top: number; width: number; height: number }

/**
 * 回飞图（关闭转场）：纯 transform 的 FLIP 实现。
 *
 * 旧版直接动画 left/top/width/height —— 每帧触发该元素的 layout + 整图重栅格化
 * （图片在每个新尺寸下重绘），安卓上是关帖掉帧主因。本实现：
 *   · 容器钉死在落点矩形（to），transform 从起点矩形（from）插值回 scale(1)；
 *   · 内层图片按帧反向缩放 scale(u/sx, u/sy)：容器的非均匀缩放被抵消成均匀缩放 u，
 *     数学上等价于 object-cover 在每帧窗口下的重新裁剪 —— 画面均匀缩放、不拉伸；
 *   · u 的起点 u0 按 object-cover 公式精确计算（需图片自然宽高比 imgRatio），
 *     保证首帧与详情图、末帧与源卡图都像素一致；拿不到比例时退化为 max 近似。
 * 每帧只改 transform = 纯合成（零 layout / 零 repaint），GPU 纹理上传一次后逐帧缩放。
 * 底部信息条复用图片的反向缩放（锚定底边）：呈现为「整卡均匀缩小」、文字不拉伸。
 */
function FlyBackImage({
  from,
  to,
  src,
  imgRatio,
  isMobile,
  title,
  username,
  onArrive,
}: {
  from: FlyRect
  to: FlyRect
  src: string
  imgRatio: number | null
  isMobile: boolean
  title: string
  username: string
  onArrive: () => void
}) {
  const progress = useMotionValue(0)

  // 起点矩形相对落点的位移与缩放（transform-origin 取容器左上角）
  const sx0 = from.width / to.width
  const sy0 = from.height / to.height
  const dx0 = from.left - to.left
  const dy0 = from.top - to.top
  // 起点画面相对落点 object-cover 的均匀缩放倍率：
  // coverScale(R) = max(R.w/natW, R.h/natH)，u0 = coverScale(from)/coverScale(to)
  const u0 = imgRatio
    ? Math.max(from.width, from.height * imgRatio) /
      Math.max(to.width, to.height * imgRatio)
    : Math.max(sx0, sy0)

  const containerTransform = useTransform(progress, (t) => {
    const sx = sx0 + (1 - sx0) * t
    const sy = sy0 + (1 - sy0) * t
    return `translate(${dx0 * (1 - t)}px, ${dy0 * (1 - t)}px) scale(${sx}, ${sy})`
  })
  // u/sx ≥ 1 恒成立（u ≥ max(sx,sy)，端点相等、中间线性 → 全程不小于）——
  // 图片与信息条放大后被容器 overflow:hidden 裁掉边缘，永不露底。
  const innerTransform = useTransform(progress, (t) => {
    const sx = sx0 + (1 - sx0) * t
    const sy = sy0 + (1 - sy0) * t
    const u = u0 + (1 - u0) * t
    return `scale(${u / sx}, ${u / sy})`
  })

  // 挂载即起飞（closing 置位时本组件才挂载；飞行期间矩形不变，依赖留空）。
  // 飞回用缓入缓出（easeInOutCubic）：轻起 → 加速 → 轻落，收拢有重量感，尾速趋近 0。
  // 移动端：0.18s、无 delay —— 关闭要立等可见地干脆利落。
  // 桌面：0.26s + 0.04s delay（先让底部内容区渐隐、图片再起飞），快速收拢。
  React.useEffect(() => {
    const controls = animate(progress, 1, {
      duration: isMobile ? 0.18 : 0.26,
      delay: isMobile ? 0 : 0.04,
      ease: [0.65, 0, 0.35, 1],
      onComplete: onArrive,
    })
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <motion.div
      className="fixed z-[50] overflow-hidden pointer-events-none select-none bg-black/20"
      style={{
        left: to.left,
        top: to.top,
        width: to.width,
        height: to.height,
        borderRadius: 14,
        transformOrigin: "0 0",
        transform: containerTransform,
        willChange: "transform",
      }}
    >
      <motion.img
        src={src}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ transform: innerTransform, transformOrigin: "50% 50%" }}
      />
      {/* 底部信息条：回飞中淡出 → 落点是图片区（无信息条），与源卡图片严丝合缝对齐 */}
      <motion.div
        className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 via-black/50 to-transparent"
        style={{ transform: innerTransform, transformOrigin: "50% 100%" }}
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.13, ease: "easeOut" }}
      >
        <div className="text-white text-[13px] font-semibold truncate">{title}</div>
        <div className="text-white/60 text-[11px] truncate">{username}</div>
      </motion.div>
    </motion.div>
  )
}
