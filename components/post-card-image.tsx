"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { Post } from "@/lib/types"
import { ImageOff, Copy, Box } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { postThumbUrl } from "@/lib/post-image-thumb"
import { postImageList } from "@/lib/post-images"
import { cdnUrl } from "@/lib/cdn-url"

interface PostCardImageProps {
  post: Post
  isMobile?: boolean
  disablePreview?: boolean
  inDetailView?: boolean
  /**
   * 横版布局下让图片容器铺满父容器高度（h-full），
   * 配合父容器的固定高度使用（例如详情页左侧列）。
   */
  fillParent?: boolean
  /**
   * 高清模式：先用缩略图秒出占位，后台加载主图(1920 webp)后无缝替换。
   * 详情页开启，让大图清晰；列表卡片关闭，仍用 640 缩略图省 egress。
   */
  fullRes?: boolean
  onImageLoad?: (dimensions: { width: number, height: number, ratio: number }) => void
}

export default function PostCardImage({
  post,
  isMobile = false,
  disablePreview = false,
  inDetailView = false,
  fillParent = false,
  fullRes = false,
  onImageLoad
}: PostCardImageProps) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageDimensions, setImageDimensions] = useState<{ width: number, height: number, ratio: number } | null>(null)
  // 缩略图缺失/失效（老帖未回填、GIF 等）时回退主图，再失败才显示错误态
  const [useFullImage, setUseFullImage] = useState(false)
  const imageRef = useRef<HTMLImageElement>(null)
  const detectedMobile = useIsMobile()

  // 使用传入的isMobile参数或通过hook检测到的值
  const isOnMobile = isMobile || detectedMobile

  // 检查是否有图片内容或imageContent
  const hasImageContent = !!post.imageContent

  // 多图角标：列表卡片上显示图片总数（详情页不显示，详情走轮播）
  const imageCount = postImageList(post).length

  // 图片直连 Supabase（Vercel 图片优化额度爆掉后 /_next/image 对新图 502，弃用）：
  // 列表与详情统一加载 640px 缩略图（同一 URL → 详情命中列表缓存、hero 飞入即时
  // 有图不闪），高清留给点击后的灯箱原图。
  const thumbUrl = postThumbUrl(post.image_url)
  const displaySrc = cdnUrl((!useFullImage && thumbUrl) || post.image_url) || ""

  // 编辑帖子换图后重置加载/错误态，按新 URL 重新走「缩略图→主图」流程
  useEffect(() => {
    setImageError(false)
    setImageLoaded(false)
    setUseFullImage(false)
  }, [post.image_url])

  // 高清模式（详情页）：缩略图先顶上（多半命中列表缓存、秒出），后台预载主图，
  // 加载完成后切到主图无缝替换为高清。无缩略图则直接上主图。
  useEffect(() => {
    if (!fullRes) return
    const full = cdnUrl(post.image_url)
    if (!full) return
    if (!thumbUrl) {
      setUseFullImage(true)
      return
    }
    const img = new Image()
    img.onload = () => setUseFullImage(true)
    img.src = full
    return () => {
      img.onload = null
    }
  }, [fullRes, post.image_url, thumbUrl])
  
  // 计算图片容器的宽高比 - 让图片按真实比例显示，形成自然的瀑布流高低错落
  // 返回 { heightClass, aspectStyle } 二选一：
  // - 详情页/铺满父容器场景仍用固定高度类
  // - 列表卡片用 aspect-ratio，按图片真实比例撑高，不再统一裁成几个固定档位
  const getImageSizing = (): { heightClass?: string; aspectStyle?: React.CSSProperties } => {
    // 横版详情：由父容器控制高度，自身铺满
    if (fillParent) return { heightClass: 'h-full' };
    // 手机竖版详情：按图片真实比例自适应高度。image_ratio 存的是 height/width，
    // CSS aspectRatio 要 width/height，故取倒数。然后 clamp 到手机可读区间：
    //   · 横图(比例高→容器矮)：自然偏扁；
    //   · 竖图(比例低→容器高)：下限 0.56（≈9:16），防超长竖图把面板几乎全占成图。
    // 关键：这里「不」再设 maxHeight。之前 aspect-ratio + maxHeight 双约束打架 ——
    // 当算出的高度超过 maxHeight 时容器被钳到 maxHeight，但 aspect-ratio 仍要求更高，
    // 子层(absolute img)按容器填、aspect 算出的多余高度却露成空白带（= 你看到的 div 露白）。
    // 单一约束（只 aspect-ratio）后高度唯一、无歧义。
    if (inDetailView) {
      const stored = post.image_ratio // height/width
      if (stored && stored > 0) {
        const wOverH = 1 / stored // width/height
        // clamp 到 [0.56, 2.4]：0.56≈9:16 竖、2.4≈12:5 超宽横
        const clamped = Math.min(Math.max(wOverH, 0.56), 2.4)
        return { aspectStyle: { aspectRatio: String(clamped) } }
      }
      // 无 ratio 元数据（老帖/无图占位回退）：保留固定高度兜底
      return { heightClass: 'h-[300px]' }
    }

    // 列表卡片用 aspect-ratio，按图片真实比例撑高。
    // image_ratio 存的是 height/width，CSS aspectRatio 要 width/height → 取倒数。
    // （此前这里没取倒数、直接当 width/height 用，导致横竖对调——竖图显示成横、
    //   横图显示成竖；只是 clamp 到 [0.75,1.9] 后被压成接近正方形，肉眼不易察觉。
    //   现在校正语义，与存储端 / 详情分支统一。）
    // 默认 1.5（≈3:2 横图）。
    const storedRatio = post.image_ratio || 0.667; // height/width，0.667≈3:2 横
    const rawRatio = 1 / storedRatio; // → width/height
    // 裁剪上下限：避免超高竖图(把卡片撑得过长)或超宽横图(变成细条)。
    // 0.75 ≈ 3:4 竖图，1.9 ≈ 接近 2:1 横图（列表卡保留较紧区间控制瀑布流高度差）
    const clampedRatio = Math.min(Math.max(rawRatio, 0.75), 1.9);

    return { aspectStyle: { aspectRatio: String(clampedRatio) } };
  };
  
  // 处理图片加载完成，包括获取图片实际尺寸
  const handleImageLoaded = useCallback((img: HTMLImageElement) => {
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const ratio = width / height;
    
    setImageLoaded(true);
    setImageDimensions({ width, height, ratio });
    
    // 如果提供了onImageLoad回调，则调用它
    if (onImageLoad) {
      onImageLoad({ width, height, ratio });
    }
  }, [onImageLoad]);
  
  // 处理图片加载错误：先回退主图，主图也挂才进错误态。
  // 必须放在所有 early return 之前——hooks 不能条件调用（react-hooks/rules-of-hooks）。
  const handleError = useCallback(() => {
    if (!useFullImage && thumbUrl) {
      setUseFullImage(true)
    } else {
      setImageError(true)
    }
  }, [useFullImage, thumbUrl])

  // 如果没有图片URL也没有imageContent，不渲染图片区域
  if (!post.image_url && !hasImageContent) {
    return null
  }
  
  // 如果有imageContent但没有图片URL，显示文字占位符
  if (hasImageContent && !post.image_url) {
    const { heightClass, aspectStyle } = getImageSizing()
    return (
      <div
        className={cn("image-glow flex items-center justify-center bg-gray-800/60 rounded-t-md", heightClass)}
        style={aspectStyle}
      >
        <div className="flex flex-col items-center text-white">
          <span className="text-4xl font-light">{post.imageContent}</span>
        </div>
      </div>
    )
  }
  
  // 如果图片加载出错，显示错误状态
  if (imageError) {
    const { heightClass, aspectStyle } = getImageSizing()
    return (
      <div
        className={cn("image-glow flex items-center justify-center bg-gray-800/60 rounded-t-md", heightClass)}
        style={aspectStyle}
      >
        <div className="flex flex-col items-center text-gray-400">
          <ImageOff className="h-6 w-6 mb-2" />
          <span className="text-sm">图片加载失败</span>
        </div>
      </div>
    )
  }

  // 使用计算的尺寸（固定高度类 或 aspect-ratio 内联样式）
  const { heightClass: imageHeight, aspectStyle } = getImageSizing();
  // 始终使用object-cover以填满容器
  const imageObjectFit = 'object-cover';

  // 容器圆角：横版贴左侧用 l 圆角，其它场景维持顶部圆角
  const roundingClass = fillParent
    ? 'md:rounded-l-[24px] md:rounded-tr-none rounded-t-md'
    : 'rounded-t-md';

  return (
    <div
      className={cn(
        "image-glow",
        inDetailView ? "detail-view-image" : "card-view-image",
        roundingClass,
        "overflow-hidden",
        !fillParent && "p-0",
        "contain-content gpu-accelerated",
        "relative",
        imageHeight
      )}
      style={aspectStyle}
    >
      {/* 主体视差只放灯箱（点击放大），详情内嵌图维持静态图 —— 否则 hover 既触发视差、
          又触发放大图标+暗角遮罩，两者抢同一手势互相打架（用户 2026-06-20 拍板）。 */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imageRef}
        src={displaySrc}
        alt={post.title || "帖子图片"}
        className={cn(
          "absolute inset-0 w-full h-full m-0",
          imageObjectFit,
          "animation-optimized"
        )}
        loading={inDetailView ? "eager" : "lazy"} // 详情页优先加载，列表卡片懒加载
        decoding="async"
        draggable={false}
        onLoad={(e) => handleImageLoaded(e.currentTarget)}
        onError={handleError}
      />
      {/* 多图角标：仅列表卡片显示（详情页走轮播，不显示） */}
      {!inDetailView && imageCount > 1 && (
        <div className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm">
          <Copy className="h-3.5 w-3.5" />
          {imageCount}
        </div>
      )}
      {/* 3D 视差角标：单图且有遮罩 → 标记「点开放大可看主体视差」，让浏览的用户知道。
          列表卡片与详情都显示（与多图互斥，单图才有遮罩）。lime 品牌色点出这是特殊效果。 */}
      {imageCount === 1 && post.image_mask_url && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-xs font-semibold text-lime-300 ring-1 ring-lime-400/30 backdrop-blur-sm">
          <Box className="h-3.5 w-3.5" />
          3D
        </div>
      )}
    </div>
  )
} 