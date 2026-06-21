"use client"

import { useEffect, useRef } from "react"

/**
 * 专属音频频谱可视化器（Canvas，底部全宽条形）。**仅本地上传歌**用：本地歌是同源
 * blob、接了 AnalyserNode，getFrequencies 返回真实 FFT。挂载由 ExpandedCard 控制：
 * 桌面端需「波形」特效模式（liquidFx === "spectrum"，与液面互斥省性能）、移动端本地歌默认挂；
 * 非本地歌根本不挂载，故这里只画真实数据、不做模拟兜底，暂停 / 无数据 → 条形落到 0。
 * 条高经「自动增益 AGC + 噪声门 + gamma 对比」整形：把最响的频段拉到接近满高、其余按比例
 * 铺开，避免大多数条都顶满显得太统一。rAF 自驱、ref 读高频值、零每帧 React 重渲染。
 * 移动端 lite：少条数 + 限 DPR，守流畅。
 */
type Props = {
  /** 填充频谱字节，返回是否为真实数据（见 PlaybackContext.getAudioFrequencies）。 */
  getFrequencies: (out: Uint8Array) => boolean
  /** 当前主色相，决定条形配色。 */
  hue: number
  /** 是否正在播放（暂停时条形落到 0）。 */
  playing: boolean
  /** 移动端/安卓：少条数 + 限 DPR。 */
  lite?: boolean
}

// 必须等于 PlaybackContext 里 analyser.frequencyBinCount（fftSize 512 → 256）。
const BINS = 256

// —— 动态范围整形（解决「大多数条都顶满、太统一」）——
// NOISE_GATE：AGC 归一化后低于此比例的条视为静音 → 落 0，拉开矮条与静音段。
// CONTRAST_GAMMA：>1 加大对比（矮条更矮、峰更突出），把挤在顶部的条铺开。
// AGC_DECAY：自动增益的滚动峰值每帧回落系数（越大越稳，避免条形整体忽大忽小）。
// AGC_FLOOR：滚动峰值下限，防止安静段落里峰值趋零导致归一化爆条。
const NOISE_GATE = 0.12
const CONTRAST_GAMMA = 1.4
const AGC_DECAY = 0.96
const AGC_FLOOR = 0.12

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

export function AudioSpectrum({ getFrequencies, hue, playing, lite = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // 高频属性塞进 ref，rAF 每帧读最新值、不重启循环。
  const propsRef = useRef({ getFrequencies, hue, playing })
  propsRef.current = { getFrequencies, hue, playing }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const barCount = lite ? 28 : 64
    const dprCap = lite ? 1.5 : 2
    const freqBuf = new Uint8Array(BINS)
    const bars = new Float32Array(barCount) // 平滑后高度 0..1
    const rawBars = new Float32Array(barCount) // 本帧各条原始能量（AGC 前）
    let agcPeak = AGC_FLOOR // 自动增益的滚动峰值，跨帧累积

    // 对数分箱：低频占更多条，更贴听感；用前 ~85% bin（高频段常空）。
    const usableBins = Math.floor(BINS * 0.85)
    const edges = new Int32Array(barCount + 1)
    for (let i = 0; i <= barCount; i++) {
      const f = i / barCount
      edges[i] = Math.min(usableBins, Math.max(1, Math.floor(Math.pow(usableBins, f))))
    }

    let raf = 0
    let w = 0
    let h = 0
    const resize = () => {
      const dpr = Math.min(dprCap, window.devicePixelRatio || 1)
      const rect = canvas.getBoundingClientRect()
      w = Math.max(1, Math.round(rect.width))
      h = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener("resize", resize)

    const slot = () => w / barCount

    const draw = () => {
      const p = propsRef.current
      ctx.clearRect(0, 0, w, h)

      // 只画真实 FFT（本地歌）。非真实数据 / 暂停 → 目标 0、条形回落。
      const real = p.playing && p.getFrequencies(freqBuf)

      if (real) {
        // ① 先算出每条的频段均值，同时记录本帧峰值（喂自动增益）。
        let frameMax = 0
        for (let i = 0; i < barCount; i++) {
          const a = edges[i]
          const b = Math.max(a + 1, edges[i + 1])
          let sum = 0
          for (let j = a; j < b; j++) sum += freqBuf[j]
          const avg = sum / ((b - a) * 255) // 0..1
          rawBars[i] = avg
          if (avg > frameMax) frameMax = avg
        }
        // ② 自动增益：遇更高帧峰立即顶上、否则缓慢回落。把「最响的那条」拉到接近满高，
        //    动态范围随之撑开——不再大家挤在顶部。AGC_FLOOR 防安静段除法爆条。
        agcPeak =
          frameMax > agcPeak ? frameMax : agcPeak * AGC_DECAY + frameMax * (1 - AGC_DECAY)
        if (agcPeak < AGC_FLOOR) agcPeak = AGC_FLOOR
      }

      for (let i = 0; i < barCount; i++) {
        let target = 0
        if (real) {
          // ③ 归一化到 AGC 峰值 → 减噪声门 → gamma 拉对比（矮条更矮、峰更突出）。
          const v = (rawBars[i] / agcPeak - NOISE_GATE) / (1 - NOISE_GATE)
          target = v > 0 ? Math.pow(v < 1 ? v : 1, CONTRAST_GAMMA) : 0
        }
        // 上升快、回落慢（更像真实频谱的余辉）。
        const cur = bars[i]
        bars[i] = target > cur ? cur + (target - cur) * 0.5 : cur + (target - cur) * 0.18
      }

      // 单个竖直渐变，全条复用（每帧一次，开销可忽略）。
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, `hsla(${p.hue} 90% 70% / 0.95)`)
      grad.addColorStop(1, `hsla(${(p.hue + 40) % 360} 85% 55% / 0.35)`)
      ctx.fillStyle = grad

      const s = slot()
      const gap = s * 0.34
      const bw = Math.max(1, s - gap)
      for (let i = 0; i < barCount; i++) {
        const bh = Math.max(1.5, bars[i] * (h - 2))
        const x = i * s + gap / 2
        roundRectPath(ctx, x, h - bh, bw, bh, 3)
        ctx.fill()
      }

      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", resize)
    }
  }, [lite])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[60] h-[26%] w-full"
    />
  )
}
