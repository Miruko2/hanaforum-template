"use client"

import { useEffect, useState } from "react"
import { Music2 } from "lucide-react"
import type { Track } from "../_data/tracks"
import { neteaseDirectCover } from "../_lib/neteasePic"

/**
 * 统一封面渲染。调用方需自带 position: relative 的定容容器，本组件填满它。
 *   · 一律原生 <img> 直连封面 CDN：歌单几百首歌 = 几百个独立源图，走 next/image
 *     每张都烧一次 Vercel Image Optimization transformation（免费额度 5K/月，已爆）；
 *     网易自家 CDN 不限并发，直连零成本。也顺带绕开 remotePatterns 白名单与
 *     服务端 fetch（SSRF 安全）。
 *   · 无封面 / 加载失败 → 占位音符（卡片自身的 hue 渐变底色会透出来）。
 *
 * 封面采用 eager + no-referrer：
 *   - eager：墙上的卡片用 3D transform 定位（布局框都在原点），浏览器 lazy 的
 *     交叉判定在 preserve-3d 下不可靠，会漏加载部分卡片封面 → 一律 eager。
 *   - referrerPolicy=no-referrer：网易等 CDN 有防盗链，跨域带 referer 会 403 →
 *     去掉 referer 即可正常取图。
 */
export function TrackCover({
  track,
  className = "object-cover",
}: {
  track: Track
  /** 历史遗留参数（next/image 时代），保留签名兼容调用方，不再使用 */
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
