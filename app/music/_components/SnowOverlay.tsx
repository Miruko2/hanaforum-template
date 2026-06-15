"use client"

import { useEffect, useRef } from "react"

/**
 * 桌面端雪花飘落叠层 —— 用库自带的 snowflakes1（threejs-components）。
 *
 * 自托管 `public/vendor/snowflakes1.min.js`（~764KB，three 已烤入，无外网依赖），
 * 懒加载。透明渲染（renderer alpha:true + clearAlpha 0 + scene.background=null），
 * 作为独立 canvas 叠在液面之上、卡片之下。
 *
 * ⚠️ 不与水面交互：snowflakes1 是独立的 WebGL 场景，雪花落下不会拨动 liquid1 的水波
 * （两套互不相通）。这里只取它的雪花视觉；要"落水起涟漪"得走自绘飘落物 + liquid 的
 * addDrop 那条路（见提交历史里的樱花版）。
 *
 * 关键：工厂 VC 返回 { three, snowflakes, loadMap, dispose }，雪花初始 visible=false，
 * 必须调 loadMap(贴图) 才显示。库不自带贴图 —— 这里现画一张白色六角雪花 dataURL 喂进去。
 *
 * 仅桌面端、随液面（rain/center）一起挂载；off 与移动端不挂载。
 */

const SNOW_URL = "/vendor/snowflakes1.min.js"

type SnowApp = {
  three?: {
    renderer?: { setClearColor?: (color: number, alpha: number) => void }
    scene?: { background: unknown }
  }
  loadMap: (url: string) => void
  dispose?: () => void
}

/** 现画一张白色六角雪花贴图（透明底 dataURL），喂给 loadMap。 */
function makeSnowTexture(): string {
  const sz = 64
  const cv = document.createElement("canvas")
  cv.width = sz
  cv.height = sz
  const ctx = cv.getContext("2d")
  if (!ctx) return ""
  ctx.translate(sz / 2, sz / 2)
  ctx.strokeStyle = "rgba(255,255,255,0.95)"
  ctx.lineWidth = 2.4
  ctx.lineCap = "round"
  const arm = (sz / 2) * 0.82
  for (let k = 0; k < 6; k++) {
    ctx.rotate(Math.PI / 3)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, -arm)
    ctx.moveTo(0, -arm * 0.5)
    ctx.lineTo(arm * 0.24, -arm * 0.74)
    ctx.moveTo(0, -arm * 0.5)
    ctx.lineTo(-arm * 0.24, -arm * 0.74)
    ctx.moveTo(0, -arm * 0.76)
    ctx.lineTo(arm * 0.17, -arm * 0.94)
    ctx.moveTo(0, -arm * 0.76)
    ctx.lineTo(-arm * 0.17, -arm * 0.94)
    ctx.stroke()
  }
  return cv.toDataURL("image/png")
}

export function SnowOverlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    let app: SnowApp | null = null
    const start = async () => {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        const mod = await import(/* webpackIgnore: true */ SNOW_URL)
        if (cancelled || !canvasRef.current) return
        const Snow = mod.default as (c: HTMLCanvasElement, cfg?: unknown) => SnowApp
        app = Snow(canvasRef.current, { snowflakes: { count: 250 } })
        // 透明：去掉背景，让底下的液面透出来（renderer 本就 alpha:true）。
        try {
          app.three?.renderer?.setClearColor?.(0x000000, 0)
          if (app.three?.scene) {
            ;(app.three.scene as { background: unknown }).background = null
          }
        } catch {
          /* 内部结构变动不致命，雪花仍在 */
        }
        app.loadMap(makeSnowTexture()) // 关键：不 loadMap 雪花不显示
        if (cancelled) {
          app.dispose?.()
          app = null
        }
      } catch {
        /* 引擎 / WebGL 不可用时静默降级（无雪花，液面照常） */
      }
    }
    void start()
    return () => {
      cancelled = true
      app?.dispose?.()
      app = null
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 block h-full w-full"
    />
  )
}
