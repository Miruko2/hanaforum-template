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
  
  // 计算图片高度 - 基于图片比例
  const getImageHeight = () => {
    // 横版详情：由父容器控制高度，自身铺满
    if (fillParent) return 'h-full';
    if (inDetailView) return 'h-[300px]'; // 详情页固定高度
    
    // 使用图片比例计算合适的高度
    const imageRatio = post.image_ratio || 1.5; // 默认宽高比1.5:1
    
    // 移动端和桌面端使用不同的高度
    if (isOnMobile) {
      // 移动端高度 - 更小的高度以适应移动设备
      if (imageRatio < 0.6) {
        // 特别高的竖图
        return 'h-[240px]';
      } else if (imageRatio < 0.8) {
        // 标准竖图
        return 'h-[220px]';
      } else if (imageRatio < 1.0) {
        // 略高于正方形
        return 'h-[200px]';
      } else if (imageRatio < 1.2) {
        // 接近正方形
        return 'h-[180px]';
      } else if (imageRatio < 1.5) {
        // 略宽于正方形
        return 'h-[160px]';
      } else if (imageRatio < 1.8) {
        // 标准横图
        return 'h-[150px]';
      } else if (imageRatio < 2.2) {
        // 较宽横图
        return 'h-[140px]';
      } else {
        // 特别宽的横图
        return 'h-[130px]';
      }
    } else {
      // 桌面端高度 - 更详细的宽高比分类，以适应不同宽高比的图片
      if (imageRatio < 0.6) {
        // 特别高的竖图
        return 'h-[350px]';
      } else if (imageRatio < 0.8) {
        // 标准竖图
        return 'h-[320px]';
      } else if (imageRatio < 1.0) {
        // 略高于正方形
        return 'h-[280px]';
      } else if (imageRatio < 1.2) {
        // 接近正方形
        return 'h-[250px]';
      } else if (imageRatio < 1.5) {
        // 略宽于正方形
        return 'h-[220px]';
      } else if (imageRatio < 1.8) {
        // 标准横图
        return 'h-[200px]';
      } else if (imageRatio < 2.2) {
        // 较宽横图
        return 'h-[180px]';
      } else {
        // 特别宽的横图
        return 'h-[160px]';
      }
    }
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
    return (
      <div className={`image-glow flex items-center justify-center bg-gray-800/60 ${getImageHeight()} rounded-t-md`}>
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
    return (
      <div className={`image-glow flex items-center justify-center bg-gray-800/60 ${getImageHeight()} rounded-t-md`}>
        <div className="flex flex-col items-center text-gray-400">
          <ImageOff className="h-6 w-6 mb-2" />
          <span className="text-sm">图片加载失败</span>
        </div>
      </div>
    )
  }

  // 使用计算的高度
  const imageHeight = getImageHeight();
  // 始终使用object-cover以填满容器
  const imageObjectFit = 'object-cover';

  // 容器圆角：横版贴左侧用 l 圆角，其它场景维持顶部圆角
  const roundingClass = fillParent
    ? 'md:rounded-l-[24px] md:rounded-tr-none rounded-t-md'
    : 'rounded-t-md';

  return (
    <div className={cn(
      "image-glow",
      inDetailView ? "detail-view-image" : "card-view-image",
      roundingClass,
      "overflow-hidden",
      !fillParent && "p-0",
      "contain-content gpu-accelerated",
      "relative",
      imageHeight
    )}>
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