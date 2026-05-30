"use client"

interface NeonMarqueeProps {
  /** 滚动方向：left 向左滚、right 向右滚 */
  direction?: "left" | "right"
  /** 重复文本条 */
  phrase?: string
  /** 滚动一圈用的秒数 */
  duration?: number
  /** 
   * bold：影院模式那种高饱和、会闪烁的招牌风
   * soft：淡雅版，不闪烁、光晕更温柔，适合登录/注册等氛围场景
   */
  variant?: "bold" | "soft"
  /** 色调。pink 是默认的影院粉，lime 对应站点绿色主题 */
  color?: "pink" | "lime"
  /** 覆盖条带高度。不传时使用各 variant 的默认值 */
  height?: number
  /**
   * 霓虹闪烁的动画延迟（秒）。
   * 多个 NeonMarquee 同屏时（如影院模式上下两条），把其中一条设为负值（-2 ~ -3）让闪烁错峰，
   * 避免两条同步闪烁形成视觉同频干扰。
   */
  flickerDelay?: number
  className?: string
}

/**
 * LED 霓虹广告牌风格的跑马灯。纯 CSS 实现，没有真像素点阵，
 * 但用粗字 + 多层 text-shadow 光晕 + LED 灯珠纹理做到"广告牌"观感。
 */
export default function NeonMarquee({
  direction = "left",
  phrase = "ホタル・シアター  •  FIREFLY CINEMA  •  NOW PLAYING  •  映画祭  •  NIGHT SHOW  •  夜の劇場",
  duration = 40,
  variant = "bold",
  color = "pink",
  height,
  flickerDelay = 0,
  className = "",
}: NeonMarqueeProps) {
  // 重复成一条长字串，配合 CSS translateX -50% 做无缝循环
  const full = Array(4).fill(phrase).join("  ·  ")

  // 通过 CSS custom property 注入闪烁延迟，避免对默认调用方造成任何影响
  const rootStyle: React.CSSProperties = {
    ...(height ? { height: `${height}px` } : null),
    ...(flickerDelay !== 0
      ? ({ ["--neon-flicker-delay" as any]: `${flickerDelay}s` } as React.CSSProperties)
      : null),
  }

  return (
    <div
      className={`neon-marquee neon-marquee-${variant} neon-marquee-${color} ${className}`}
      style={Object.keys(rootStyle).length > 0 ? rootStyle : undefined}
    >
      {/* LED 灯珠纹理底层 */}
      <div className="neon-marquee-leds" aria-hidden />

      {/* 跑马灯文本 */}
      <div
        className={`neon-marquee-track ${direction === "right" ? "to-right" : "to-left"}`}
        style={{ animationDuration: `${duration}s` }}
      >
        <span className="neon-marquee-text">{full}</span>
        <span className="neon-marquee-text">{full}</span>
      </div>

      {/* 上下细缝高光，模拟灯管与外壳之间的反光 */}
      <div className="neon-marquee-highlight-top" aria-hidden />
      <div className="neon-marquee-highlight-bottom" aria-hidden />
    </div>
  )
}
