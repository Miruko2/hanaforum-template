"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Music2 } from "lucide-react"
import type { Track } from "../_data/tracks"
import { neteaseDirectCover } from "../_lib/neteasePic"

/**
 * 统一封面渲染。调用方需自带 position: relative 的定容容器，本组件填满它。
 *   · 用户曲目（userProvided，封面是任意外链）→ 原生 <img>，绕开 next/image 的
 *     remotePatterns 白名单，且不触发服务端图片优化 / fetch（SSRF 安全）。
 *   · 精选墙曲目（封面在白名单 CDN）→ next/image，保留优化与缓存。
 *   · 无封面 / 加载失败 → 占位音符（卡片自身的 hue 渐变底色会透出来）。
 *
 * 用户封面采用 eager + no-referrer：
 *   - eager：墙上的卡片用 3D transform 定位（布局框都在原点），浏览器 lazy 的
 *     交叉判定在 preserve-3d 下不可靠，会漏加载部分卡片封面 → 一律 eager。
 *   - referrerPolicy=no-referrer：网易等 CDN 有防盗链，跨域带 referer 会 403 →
 *     去掉 referer 即可正常取图。
 */
export function TrackCover({
  track,
  sizes,
  priority = false,
  className = "object-cover",
}: {
  track: Track
  sizes?: string
  priority?: boolean
  className?: string
}) {
  const [errored, setErrored] = useState(false)
  // 切换到另一首（封面 URL 变化）时重置错误态。
  useEffect(() => setErrored(false), [track.cover])

  if (!track.cover || errored) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-white/5 text-white/40">
        <Music2 size={18} />
      </div>
    )
  }
  if (track.userProvided) {
    // 网易封面：把 injahow 跳转换成网易 CDN 直链（稳、并发无压）；其它原样。
    const src = neteaseDirectCover(track.cover)
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={track.title}
        loading="eager"
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setErrored(true)}
        className={`absolute inset-0 h-full w-full ${className}`}
      />
    )
  }
  return (
    <Image
      src={track.cover}
      alt={track.title}
      fill
      sizes={sizes}
      className={className}
      priority={priority}
    />
  )
}
