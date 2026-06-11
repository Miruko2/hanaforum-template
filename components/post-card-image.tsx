"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { Post } from "@/lib/types"
import { ImageOff } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import Image from "next/image"

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
  onImageLoad?: (dimensions: { width: number, height: number, ratio: number }) => void
}

export default function PostCardImage({
  post,
  isMobile = false,
  disablePreview = false,
  inDetailView = false,
  fillParent = false,
  onImageLoad
}: PostCardImageProps) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageDimensions, setImageDimensions] = useState<{ width: number, height: number, ratio: number } | null>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const detectedMobile = useIsMobile()
  
  // 使用传入的isMobile参数或通过hook检测到的值
  const isOnMobile = isMobile || detectedMobile
  
  // 检查是否有图片内容或imageContent
  const hasImageContent = !!post.imageContent
  
  // 图片质量：详情页与列表页保持同一档，确保「列表图 = 详情图」是同一个 next/image URL，
  // 详情页直接命中列表已加载的缓存 → hero 飞入即时有图、不闪。高清留给点击后的灯箱原图。
  const imageQuality = isOnMobile ? 40 : 65
  
  // 计算图片容器的宽高比 - 让图片按真实比例显示，形成自然的瀑布流高低错落
  // 返回 { heightClass, aspectStyle } 二选一：
  // - 详情页/铺满父容器场景仍用固定高度类
  // - 列表卡片用 aspect-ratio，按图片真实比例撑高，不再统一裁成几个固定档位
  const getImageSizing = (): { heightClass?: string; aspectStyle?: React.CSSProperties } => {
    // 横版详情：由父容器控制高度，自身铺满
    if (fillParent) return { heightClass: 'h-full' };
    if (inDetailView) return { heightClass: 'h-[300px]' }; // 详情页固定高度

    // 图片宽高比 = 宽 / 高，默认 1.5:1
    const rawRatio = post.image_ratio || 1.5;
    // 裁剪上下限：避免超高竖图(把卡片撑得过长)或超宽横图(变成细条)
    // 0.75 ≈ 3:4 竖图，1.9 ≈ 接近 2:1 横图
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
  
  // 处理图片加载错误
  const handleError = useCallback(() => {
    setImageError(true)
  }, [])

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
      <Image
        ref={imageRef}
        src={post.image_url || ""}
        alt={post.title || "帖子图片"}
        className={cn(
          "w-full h-full",
          imageObjectFit,
          "animation-optimized",
          inDetailView && "absolute inset-0 m-0"
        )}
        onLoadingComplete={handleImageLoaded}
        onError={handleError}
        quality={imageQuality}
        sizes={
          // 详情页（fillParent / inDetailView）与列表页用同一 sizes，配合同一 quality，
          // 让 next/image 生成同一个 URL，hero 转场复用列表缓存、飞入不闪。
          "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        }
        fill
        priority={inDetailView} // 详情页图片设为优先加载
      />
    </div>
  )
} 