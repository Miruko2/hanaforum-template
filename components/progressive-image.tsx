"use client"

import { useState, useEffect, useCallback, useRef, memo } from "react"
import Image from "next/image"
import { cn } from "@/lib/utils"
import { AnimatePresence, motion } from "framer-motion"
import { X, ZoomIn, ImageOff } from "lucide-react"
import { FloatingCardsLoading } from "./ui/loading-animation"

// 全局图片缓存
const imageCache = new Map<string, HTMLImageElement>();

// 优化的图片格式检测
const supportedFormats = {
  webp: null as boolean | null,
  avif: null as boolean | null,
}

// 检测浏览器是否支持WebP - 使用懒加载和单例模式
const supportsWebP = (() => {
  let result: boolean | null = null;
  
  return (): boolean => {
    if (result !== null) return result;
    if (typeof document === 'undefined') return false;
    
    try {
      const elem = document.createElement('canvas');
      if (elem.getContext && elem.getContext('2d')) {
        result = elem.toDataURL('image/webp').indexOf('data:image/webp') === 0;
        return result;
      }
    } catch (e) {
      // 忽略错误
    }
    
    result = false;
    return false;
  };
})();

// 检测浏览器是否支持AVIF - 使用懒加载和单例模式
const supportsAVIF = (() => {
  let result: boolean | null = null;
  let checking = false;
  
  return (): boolean => {
    if (result !== null) return result;
    if (typeof window === 'undefined') return false;
    
    // 默认返回false，但安排异步检测
    if (!checking) {
      checking = true;
      try {
        const img = new window.Image();
        img.onload = () => { result = true; };
        img.onerror = () => { result = false; };
        img.src = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErK42A=';
      } catch (e) {
        result = false;
      }
    }
    
    // 返回最佳猜测
    return result || false;
  };
})();

// 网络状态检测 - 使用缓存，减少重复计算
let cachedNetworkCondition: 'slow' | 'medium' | 'fast' | null = null;
let lastNetworkCheck = 0;

const getNetworkCondition = (): 'slow' | 'medium' | 'fast' => {
  const now = Date.now();
  
  // 如果距离上次检测不足10秒，返回缓存结果
  if (cachedNetworkCondition && now - lastNetworkCheck < 10000) {
    return cachedNetworkCondition;
  }
  
  if (typeof navigator === 'undefined') {
    cachedNetworkCondition = 'fast';
    return 'fast';
  }
  
  const connection = (navigator as any).connection;
  
  if (!connection) {
    cachedNetworkCondition = 'fast';
    return 'fast';
  }
  
  if (connection.saveData) {
    cachedNetworkCondition = 'slow';
    return 'slow';
  }
  
  const effectiveType = connection.effectiveType;
  if (effectiveType === 'slow-2g' || effectiveType === '2g') {
    cachedNetworkCondition = 'slow';
  } else if (effectiveType === '3g') {
    cachedNetworkCondition = 'medium';
  } else {
    cachedNetworkCondition = 'fast';
  }
  
  lastNetworkCheck = now;
  return cachedNetworkCondition;
}

interface ProgressiveImageProps {
  src: string
  alt: string
  className?: string
  aspectRatio?: number
  priority?: boolean
  width?: number
  height?: number
  thumbnailSrc?: string
  previewable?: boolean
  preserveOriginal?: boolean
  quality?: number
  onImageLoad?: () => void
  onError?: () => void
  stopPropagation?: boolean
  previewZIndex?: number
  preserveRatio?: boolean
  fitMode?: 'cover' | 'contain' | 'fill'
  lowQualityInBackground?: boolean
  blurLevel?: number
  loadingIndicator?: 'pulse' | 'skeleton' | 'spinner' | 'none'
  placeholderColor?: string
}

// 使用React.memo包裹整个组件以避免不必要的重新渲染
const ProgressiveImage = memo(({
  src,
  alt,
  className,
  aspectRatio,
  priority = false,
  width,
  height,
  thumbnailSrc,
  previewable = false,
  preserveOriginal = false,
  quality = 70,
  onImageLoad,
  onError,
  stopPropagation = false,
  previewZIndex = 50,
  preserveRatio = false,
  fitMode = 'cover',
  lowQualityInBackground = true,
  blurLevel = 8,
  loadingIndicator = 'pulse',
  placeholderColor = '#1e293b',
}: ProgressiveImageProps) => {
  const [isLoading, setIsLoading] = useState(true)
  const [showFullImage, setShowFullImage] = useState(false)
  const [currentSrc, setCurrentSrc] = useState(thumbnailSrc || src)
  const [error, setError] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [imageRatio, setImageRatio] = useState(aspectRatio || 1)
  const [isInView, setIsInView] = useState(false)
  const [networkCondition, setNetworkCondition] = useState<'slow' | 'medium' | 'fast'>('fast')
  const [devicePixelRatio, setDevicePixelRatio] = useState(1)
  const imageRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hasCalledOnLoad = useRef(false)
  const isMounted = useRef(true)
  const loadStartTime = useRef<number>(0)

  // 更新设备像素比
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDevicePixelRatio(window.devicePixelRatio || 1);
      
      // 监听设备像素比变化 (比如旋转设备或更改缩放)
      const mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      
      const updatePixelRatio = () => {
        setDevicePixelRatio(window.devicePixelRatio || 1);
      };
      
      mediaQuery.addEventListener('change', updatePixelRatio);
      
      return () => {
        mediaQuery.removeEventListener('change', updatePixelRatio);
      };
    }
  }, []);

  // 更新网络状态
  useEffect(() => {
    const updateNetworkCondition = () => {
      setNetworkCondition(getNetworkCondition());
    };
    
    updateNetworkCondition();
    
    // 监听网络状态变化
    if (typeof navigator !== 'undefined' && (navigator as any).connection) {
      (navigator as any).connection.addEventListener('change', updateNetworkCondition);
    }
    
    // 额外的速度监测 - 通过小图片测速
    if (typeof window !== 'undefined' && !priority) {
      setTimeout(() => {
        const startTime = performance.now();
        const testImage = new window.Image();
        
        testImage.onload = () => {
          const endTime = performance.now();
          const loadTime = endTime - startTime;
          
          // 基于加载时间调整网络状态
          if (loadTime > 500) {
            setNetworkCondition('slow');
          } else if (loadTime > 200) {
            setNetworkCondition('medium');
          }
        };
        
        // 加载一个1KB小图标以测试连接
        testImage.src = '/favicon.ico?test=' + new Date().getTime();
      }, 0);
    }
    
    return () => {
      if (typeof navigator !== 'undefined' && (navigator as any).connection) {
        (navigator as any).connection.removeEventListener('change', updateNetworkCondition);
      }
    };
  }, [priority]);

  // 使用交叉观察器监测图片元素可见性
  useEffect(() => {
    if (priority) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '300px', // 增加预加载距离到300px
        threshold: 0.01,
      }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [priority]);

  // 使用缩略图或原图作为初始显示
  useEffect(() => {
    // 当src变化时重置状态
    setCurrentSrc(thumbnailSrc || src)
    setIsLoading(true)
    setError(false)
    setShowFullImage(false)
    hasCalledOnLoad.current = false
    return () => {
      isMounted.current = false
    }
  }, [src, thumbnailSrc])

  // 生成优化的图片URL
  const getOptimizedUrl = useCallback((url: string, isFullImage: boolean = false) => {
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
    
    // 判断是否可以添加查询参数
    const canAddParams = !url.includes('.svg') && !url.includes('.gif');
    if (!canAddParams) return url;
    
    // 分析当前URL
    const urlObj = new URL(url, window.location.href);
    const isExternalImage = urlObj.origin !== window.location.origin;
    
    // 如果已经有格式参数，或者是外部图片且不确定能否处理参数，则不修改
    if (urlObj.searchParams.has('format') || 
        (isExternalImage && !url.includes('unsplash.com') && 
         !url.includes('picsum.photos') && 
         !url.includes('placeholder'))) {
      return url;
    }
    
    // 确定需要的质量
    let qualityParam = quality;
    
    // 如果是全尺寸图片（预览或详情页），保持高质量
    if (isFullImage) {
      qualityParam = Math.max(85, quality); // 保持高质量
    } else {
      // 在列表视图中根据网络状况降低质量
      if (networkCondition === 'slow') {
        qualityParam = Math.max(40, quality - 35);
      } else if (networkCondition === 'medium') {
        qualityParam = Math.max(50, quality - 20);
      }
      
      // 非全尺寸图片进一步降低质量
      if (lowQualityInBackground) {
        qualityParam = Math.max(30, qualityParam - 25);
      }
    }
    
    // 确定宽度
    let widthParam = width ? Math.round(width * devicePixelRatio) : undefined;
    if (widthParam) {
      if (networkCondition === 'slow') {
        widthParam = Math.round(widthParam * 0.6);
      } else if (networkCondition === 'medium') {
        widthParam = Math.round(widthParam * 0.8);
      }
    }
    
    // 构建查询参数
    const params: Record<string, string> = {};
    
    // 添加宽度参数
    if (widthParam && !urlObj.searchParams.has('width')) {
      params.width = widthParam.toString();
    }
    
    // 添加质量参数
    params.quality = qualityParam.toString();
    
    // 添加格式参数 - 异步检查格式支持
    // AVIF有更好的压缩率但可能不如WebP普及
    const checkFormatSupport = async () => {
      const avifSupported = await supportsAVIF();
      const webpSupported = supportsWebP();
      
      if (avifSupported) {
        params.format = 'avif';
      } else if (webpSupported) {
        params.format = 'webp';
      }
      
      // 添加所有参数到URL
      Object.entries(params).forEach(([key, value]) => {
        urlObj.searchParams.set(key, value);
      });
      
      if (isMounted.current) {
        return urlObj.toString();
      }
      return url;
    };
    
    // 立即使用可能已缓存的格式检查结果
    if (supportedFormats.avif === true) {
      params.format = 'avif';
    } else if (supportedFormats.webp === true) {
      params.format = 'webp';
    }
    
    // 添加所有参数到URL
    Object.entries(params).forEach(([key, value]) => {
      urlObj.searchParams.set(key, value);
    });
    
    // 如果格式检测尚未完成，稍后更新
    if (supportedFormats.avif === null && supportedFormats.webp === null) {
      checkFormatSupport().then(optimizedUrl => {
        if (isMounted.current && !error) {
          setCurrentSrc(optimizedUrl);
        }
      });
    }
    
    return urlObj.toString();
  }, [devicePixelRatio, error, lowQualityInBackground, networkCondition, quality, src, width]);

  // 高质量图片加载
  useEffect(() => {
    if (!thumbnailSrc || showFullImage || !isMounted.current || !isInView) return
    
    // 记录加载开始时间（用于性能分析）
    loadStartTime.current = performance.now();
    
    // 检查缓存中是否已有图片
    if (imageCache.has(src)) {
      // 使用缓存图片，立即更新状态
      setShowFullImage(true)
      setCurrentSrc(src)
      setIsLoading(false)
      
      // 获取真实宽高比
      const cachedImg = imageCache.get(src)
      if (!aspectRatio && cachedImg && cachedImg.width && cachedImg.height) {
        const realRatio = cachedImg.height / cachedImg.width
        setImageRatio(realRatio)
      }
      
      if (!hasCalledOnLoad.current) {
        hasCalledOnLoad.current = true
        onImageLoad?.()
      }
      
      // 记录缓存命中性能
      const loadTime = performance.now() - loadStartTime.current;
      console.debug(`图片缓存命中: ${src.substring(0, 30)}... 加载时间: ${loadTime.toFixed(2)}ms`);
      
      return
    }
    
    // 获取优化的图片URL
    const optimizedImageUrl = getOptimizedUrl(src, true);
    
    // 创建一个隐藏的图片元素来预加载高质量图片
    const imgElement = new window.Image()
    imgElement.src = optimizedImageUrl
    
    imgElement.onload = () => {
      if (!isMounted.current) return
      
      // 高质量图片加载完成，设置到当前展示
      setShowFullImage(true)
      setCurrentSrc(optimizedImageUrl)
      setIsLoading(false)
      
      // 获取真实宽高比
      if (!aspectRatio && imgElement.width && imgElement.height) {
        const realRatio = imgElement.height / imgElement.width
        setImageRatio(realRatio)
      }

      // 存入缓存
      imageCache.set(src, imgElement)
      
      // 记录加载性能
      const loadTime = performance.now() - loadStartTime.current;
      console.debug(`图片加载完成: ${src.substring(0, 30)}... 加载时间: ${loadTime.toFixed(2)}ms`);

      // 调用外部回调
      if (!hasCalledOnLoad.current) {
        hasCalledOnLoad.current = true
        onImageLoad?.()
      }
    }
    
    imgElement.onerror = () => {
      if (!isMounted.current) return
      
      // 如果高质量图片加载失败，但缩略图加载成功，保持显示缩略图
      if (thumbnailSrc) {
        setIsLoading(false)
      } else {
        setError(true)
        setIsLoading(false)
        // 调用外部错误回调
        onError?.()
      }
      
      console.error(`图片加载失败: ${src}`);
    }
  }, [src, thumbnailSrc, aspectRatio, showFullImage, onImageLoad, onError, isInView, networkCondition, getOptimizedUrl])

  // 处理图片加载完成
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setIsLoading(false)
    
    // 如果没有传入aspectRatio，使用实际图片的宽高比
    if (!aspectRatio && e.currentTarget.naturalWidth && e.currentTarget.naturalHeight) {
      const realRatio = e.currentTarget.naturalHeight / e.currentTarget.naturalWidth
      setImageRatio(realRatio)
    }

    // 调用外部回调
    if (!hasCalledOnLoad.current) {
      hasCalledOnLoad.current = true
      onImageLoad?.()
    }
  }, [aspectRatio, onImageLoad])

  // 处理图片加载错误
  const handleImageError = useCallback(() => {
    setError(true)
    setIsLoading(false)
    // 设置为占位图
    setCurrentSrc(`/placeholder.svg?height=400&width=600&query=图片加载失败`)
    // 调用外部错误回调
    onError?.()
  }, [onError])

  // 点击图片查看大图
  const handleImageClick = (e: React.MouseEvent) => {
    // 如果不可预览，直接返回，不阻止事件冒泡
    if (!previewable) {
      return;
    }
    
    // 如果需要阻止冒泡且可预览
    if (stopPropagation) {
      e.stopPropagation();
    }

    if (previewable && !error) {
      setShowPreview(true)
      // 禁用背景滚动
      document.body.style.overflow = "hidden"
    }
  }

  // 关闭预览
  const closePreview = () => {
    setShowPreview(false)
    // 恢复背景滚动
    document.body.style.overflow = ""
  }

  // 处理预览模式中的点击事件
  const handlePreviewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  }

  // 使用适合当前网络情况的大小和质量
  const getResponsiveImageProps = () => {
    // 更智能的响应式尺寸处理
    let sizes = "";
    
    // 根据设备尺寸优化sizes属性
    if (typeof window !== 'undefined') {
      const windowWidth = window.innerWidth;
      
      if (windowWidth <= 640) {
        // 移动设备占满宽度
        sizes = "100vw";
      } else if (windowWidth <= 1024) {
        // 平板设备占一半或更多
        sizes = "50vw";
      } else {
        // 桌面设备根据实际情况
        sizes = "(max-width: 1536px) 33vw, 25vw";
      }
    } else {
      // 默认响应式设置
      sizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";
    }
    
    // 质量参数调整
    let imgQuality = quality;
    
    // 根据网络状况调整
    if (networkCondition === 'slow') {
      imgQuality = Math.max(50, quality - 30); // 降低质量但不低于50
    } else if (networkCondition === 'medium') {
      imgQuality = Math.max(60, quality - 15);
    }
    
    return { sizes, quality: imgQuality };
  };

  const { sizes, quality: responsiveQuality } = getResponsiveImageProps();

  // 根据loadingIndicator选择合适的加载指示器
  const renderLoadingIndicator = () => {
    if (!isLoading || loadingIndicator === 'none') return null;
    
    switch (loadingIndicator) {
      case 'pulse':
        return (
          <div className="absolute inset-0 flex items-center justify-center">
            <FloatingCardsLoading size="md" color="text-lime-400" />
          </div>
        );
      case 'skeleton':
        return (
          <div 
            className="absolute inset-0 bg-gradient-to-r from-gray-800/50 to-gray-700/50 animate-pulse"
            style={{ backgroundColor: placeholderColor }}
          />
        );
      case 'spinner':
        return (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 border-4 border-t-lime-400 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
          </div>
        );
      default:
        return (
          <div className="absolute inset-0 flex items-center justify-center">
            <FloatingCardsLoading size="md" color="text-lime-400" />
          </div>
        );
    }
  };

  return (
    <>
      <div 
        ref={containerRef}
        className={cn(
          "relative overflow-hidden", 
          isLoading && loadingIndicator === 'pulse' && "animate-pulse bg-gray-700/50",
          previewable && !error && "cursor-zoom-in",
          className
        )}
        style={aspectRatio && !preserveRatio ? { aspectRatio: String(aspectRatio) } : undefined}
        onClick={handleImageClick}
      >
        {/* 图片渲染 */}
        {(isInView || priority) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ 
              opacity: error ? 0 : 1,
              filter: isLoading || (!showFullImage && thumbnailSrc) ? `blur(${blurLevel}px)` : "blur(0px)" 
            }}
            transition={{ duration: 0.5 }}
            className="w-full h-full"
          >
            <Image
              src={getOptimizedUrl(currentSrc || "/placeholder.svg", showFullImage)}
              alt={alt}
              fill={true}
              width={0}
              height={0}
              className={cn(
                "transition-all duration-300",
                isLoading ? "scale-105" : "scale-100",
                fitMode === 'contain' ? "object-contain" : 
                fitMode === 'fill' ? "object-fill" : "object-cover"
              )}
              onLoad={handleImageLoad}
              onError={handleImageError}
              priority={priority}
              quality={responsiveQuality}
              sizes={sizes}
              ref={imageRef}
            />
          </motion.div>
        )}

        {/* 加载中状态 */}
        {renderLoadingIndicator()}

        {/* 错误状态 */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-800/40 text-gray-300">
            <ImageOff className="h-8 w-8 mb-2" />
            <p className="text-xs">图片加载失败</p>
          </div>
        )}
      </div>

      {/* 大图预览模式 */}
      <AnimatePresence>
        {showPreview && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 z-[${previewZIndex}] bg-black/90 flex items-center justify-center`}
            onClick={closePreview}
          >
            <div 
              className="relative max-w-[90vw] max-h-[90vh]"
              onClick={handlePreviewClick}
            >
              <Image 
                src={getOptimizedUrl(src, true)}
                alt={alt}
                width={1200}
                height={1200}
                className={cn(
                  "max-w-[90vw] max-h-[90vh] rounded-lg object-contain",
                  preserveOriginal ? "w-auto h-auto" : "w-full h-full"
                )}
                quality={95}
                priority
              />
              
              <button 
                onClick={closePreview}
                className="absolute top-3 right-3 bg-black/60 text-white p-2 rounded-full hover:bg-black/80 transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
              
              <div className="absolute bottom-3 right-3 bg-black/60 text-white p-2 rounded-full">
                <ZoomIn className="h-6 w-6" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
})

ProgressiveImage.displayName = "ProgressiveImage"

export default ProgressiveImage
