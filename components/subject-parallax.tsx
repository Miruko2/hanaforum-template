"use client"

// 主体视差渲染组件：一张图 + 一张深度遮罩（主体近/背景远），用 WebGL 着色器
// 按深度位移 UV，鼠标/拖动时主体跟手、背景几乎不动。单图位移、无第二层副本 →
// 无残影。遮罩缺失 / WebGL 不可用 / 任何加载失败 → 自动回退原生 <img>。
// 调用方负责「是否启用」的判定（单图 + 有遮罩），见 image-lightbox 单图分支。
// 安卓 APK 也启用：组件内部对 WebView 做降级（canvas 瞬显不淡入、触摸抬指回中）。

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { detectIsAndroidApp } from "@/app/music/_lib/useIsAndroid"

interface SubjectParallaxProps {
  src: string // 高清主图 URL（已 cdnUrl 处理）
  maskSrc: string // 遮罩 URL（已 cdnUrl 处理）
  fallbackSrc?: string // 画布就绪前/失败时显示的图（缩略图或主图）
  alt?: string
  className?: string
  strength?: number // 位移幅度，默认 0.05
}

const PIVOT = 0.2 // 背景(depth~0)几乎不动、主体(depth~1)位移最大
const ZOOM = 1.06 // 轻微放大，给边缘位移留余量、避免露出画布边

const VERT = `attribute vec2 aPos; varying vec2 vUv;
void main(){ vUv=aPos*0.5+0.5; vUv.y=1.0-vUv.y; gl_Position=vec4(aPos,0.0,1.0); }`

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vUv;
uniform sampler2D uImage;
uniform sampler2D uDepth;
uniform vec2 uOffset;
uniform float uStrength;
uniform vec2 uCover;
const float PIVOT=${PIVOT.toFixed(2)};
const float ZOOM=${ZOOM.toFixed(2)};
void main(){
  vec2 base = 0.5 + (vUv-0.5)*(uCover/ZOOM);   // cover 裁切 + 轻微放大
  vec2 dir = uOffset*uStrength;
  vec2 uv = base;
  for(int i=0;i<4;i++){ float d=texture2D(uDepth,uv).r; uv = base + dir*(d-PIVOT); }
  gl_FragColor = texture2D(uImage, uv);
}`

export default function SubjectParallax({
  src,
  maskSrc,
  fallbackSrc,
  alt,
  className,
  strength = 0.05,
}: SubjectParallaxProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  // 安卓 APK(Capacitor WebView)：去掉 canvas 淡入过渡，就绪即瞬显。WebView 合成器对
  // 「不透明 WebGL canvas 的 opacity 渐变」易闪/撕裂；瞬显更稳（canvas 只在纹理就绪、
  // 画完首帧后才显示，无半成品）。桌面/移动浏览器保留 300ms 淡入。
  const [isApp] = useState(detectIsAndroidApp)

  useEffect(() => {
    const wrap = wrapRef.current!
    const canvas = canvasRef.current!
    if (!wrap || !canvas) return
    let disposed = false
    let raf = 0
    // 回退到静态 <img>。失败原因走 console.debug（默认隐藏、不刷屏）：避免组件「静默失败」
    // 难排查——真出问题时把浏览器控制台切到 Verbose 即可看到原因（WebGL/着色器/跨域等）。
    const fail = (reason?: unknown) => {
      if (!disposed) {
        console.debug("[SubjectParallax] fallback to <img>:", reason)
        setFailed(true)
      }
    }

    let gl: WebGLRenderingContext | null = null
    try {
      gl = (canvas.getContext("webgl", { antialias: true, alpha: false }) ||
        canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null
    } catch { gl = null }
    // isContextLost 兜底：若拿回的是已丢失的上下文（理论上本组件已不再 loseContext，
    // 但防御性处理），直接回退静态图，避免在死上下文上编译着色器报无意义的 "shader" 错。
    if (!gl || gl.isContextLost()) { fail("WebGL 上下文不可用"); return }
    const glc = gl

    function shader(type: number, srcStr: string) {
      const s = glc.createShader(type)!
      glc.shaderSource(s, srcStr); glc.compileShader(s)
      if (!glc.getShaderParameter(s, glc.COMPILE_STATUS)) throw new Error(glc.getShaderInfoLog(s) || "shader")
      return s
    }
    let prog: WebGLProgram, buf: WebGLBuffer, texImg: WebGLTexture, texDepth: WebGLTexture
    let U: Record<string, WebGLUniformLocation | null>
    try {
      prog = glc.createProgram()!
      glc.attachShader(prog, shader(glc.VERTEX_SHADER, VERT))
      glc.attachShader(prog, shader(glc.FRAGMENT_SHADER, FRAG))
      glc.linkProgram(prog); glc.useProgram(prog)
      buf = glc.createBuffer()!
      glc.bindBuffer(glc.ARRAY_BUFFER, buf)
      glc.bufferData(glc.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), glc.STATIC_DRAW)
      const aPos = glc.getAttribLocation(prog, "aPos")
      glc.enableVertexAttribArray(aPos); glc.vertexAttribPointer(aPos, 2, glc.FLOAT, false, 0, 0)
      U = {
        image: glc.getUniformLocation(prog, "uImage"),
        depth: glc.getUniformLocation(prog, "uDepth"),
        offset: glc.getUniformLocation(prog, "uOffset"),
        strength: glc.getUniformLocation(prog, "uStrength"),
        cover: glc.getUniformLocation(prog, "uCover"),
      }
      glc.uniform1i(U.image, 0); glc.uniform1i(U.depth, 1)
    } catch (e) { fail("着色器/程序初始化失败: " + ((e as Error)?.message || e)); return }

    function makeTex(unit: number) {
      const t = glc.createTexture()!
      glc.activeTexture(glc.TEXTURE0 + unit); glc.bindTexture(glc.TEXTURE_2D, t)
      glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_WRAP_S, glc.CLAMP_TO_EDGE)
      glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_WRAP_T, glc.CLAMP_TO_EDGE)
      glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_MIN_FILTER, glc.LINEAR)
      glc.texParameteri(glc.TEXTURE_2D, glc.TEXTURE_MAG_FILTER, glc.LINEAR)
      return t
    }
    texImg = makeTex(0); texDepth = makeTex(1)

    const loadImage = (url: string) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        i.crossOrigin = "anonymous"
        i.onload = () => res(i); i.onerror = rej
        i.src = url
      })

    const target = { x: 0, y: 0 }
    const current = { x: 0, y: 0 }
    let interacting = false
    let img: HTMLImageElement | null = null

    function resize() {
      if (!img) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cw = Math.max(1, Math.round(wrap.clientWidth * dpr))
      const ch = Math.max(1, Math.round(wrap.clientHeight * dpr))
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
      const arC = cw / ch, arI = img.naturalWidth / img.naturalHeight
      let sx = 1, sy = 1
      if (arC > arI) sy = arI / arC; else sx = arC / arI
      glc.useProgram(prog); glc.uniform2f(U.cover, sx, sy)
    }

    function frame() {
      // 无交互时回中（不做扰人的自动摆动）
      if (!interacting) { target.x *= 0.9; target.y *= 0.9 }
      current.x += (target.x - current.x) * 0.1
      current.y += (target.y - current.y) * 0.1
      glc.viewport(0, 0, canvas.width, canvas.height)
      glc.uniform2f(U.offset, current.x, current.y)
      glc.uniform1f(U.strength, strength)
      glc.drawArrays(glc.TRIANGLE_STRIP, 0, 4)
      raf = requestAnimationFrame(frame)
    }

    function onPointer(e: PointerEvent) {
      const r = wrap.getBoundingClientRect()
      const rawX = ((e.clientX - r.left) / r.width) * 2 - 1
      const rawY = -(((e.clientY - r.top) / r.height) * 2 - 1)
      // tanh 软压：中心附近灵敏度≈线性(斜率~1、手感不变)，越靠边/出界位移越收敛、
      // 不再线性冲到极值。大幅晃动时主体(深度~1)与背景(深度~0)朝反向位移、交界处会错切
      // 撕扯——位移越大越明显；软压住极值即可消除瑕疵，又不牺牲正常范围的视差感。
      target.x = Math.tanh(rawX)
      target.y = Math.tanh(rawY)
      interacting = true
    }
    function onLeave() { interacting = false; target.x = 0; target.y = 0 }

    Promise.all([loadImage(src), loadImage(maskSrc)])
      .then(([image, mask]) => {
        if (disposed) return
        img = image
        // 主图纹理
        glc.activeTexture(glc.TEXTURE0); glc.bindTexture(glc.TEXTURE_2D, texImg)
        glc.texImage2D(glc.TEXTURE_2D, 0, glc.RGBA, glc.RGBA, glc.UNSIGNED_BYTE, image)
        // 深度纹理 = 遮罩，做一遍羽化让位移过渡平滑（主体↔背景交界从硬边变渐变带，
        // 否则大位移时像「没羽化的抠图硬贴」很突兀）。
        // ⚠️ 不用 ctx.filter="blur()"：iOS/iPadOS WebKit 长期不支持 canvas 2D filter
        //    （iOS<17 完全无效、之后也有 quirks），会被静默忽略 → iPad 遮罩没羽化、硬边
        //    （PC/安卓 Chromium 内核支持故正常，「偏偏 iPad 突兀」即此）。改用「缩小再放大」：
        //    downscale 做块平均、upscale 走 bilinear 插值 → 平滑渐变 ≈ 模糊，全平台一致、iOS 安全。
        const mw = mask.naturalWidth, mh = mask.naturalHeight
        const feather = Math.max(1, Math.round(Math.max(mw, mh) * 0.017)) // 羽化半径(px)，≈缩小倍率
        const sw = Math.max(1, Math.round(mw / feather))
        const sh = Math.max(1, Math.round(mh / feather))
        const small = document.createElement("canvas"); small.width = sw; small.height = sh
        const sctx = small.getContext("2d")!
        sctx.imageSmoothingEnabled = true
        sctx.drawImage(mask, 0, 0, sw, sh) // 缩小（块平均）
        const dc = document.createElement("canvas"); dc.width = mw; dc.height = mh
        const dx = dc.getContext("2d")!
        dx.imageSmoothingEnabled = true
        dx.imageSmoothingQuality = "high"
        dx.drawImage(small, 0, 0, mw, mh) // 放大（bilinear → 平滑渐变 = 羽化）
        glc.activeTexture(glc.TEXTURE1); glc.bindTexture(glc.TEXTURE_2D, texDepth)
        glc.texImage2D(glc.TEXTURE_2D, 0, glc.RGBA, glc.RGBA, glc.UNSIGNED_BYTE, dc)
        resize()
        setReady(true)
        wrap.addEventListener("pointermove", onPointer)
        wrap.addEventListener("pointerdown", onPointer)
        wrap.addEventListener("pointerleave", onLeave)
        wrap.addEventListener("pointercancel", onLeave)
        // 触屏抬指回中：pointerup 在触摸结束时触发（部分 WebView 不可靠地补发
        // pointerleave，故显式监听 pointerup），松手后图缓动回正、不停在歪位。
        wrap.addEventListener("pointerup", onLeave)
        raf = requestAnimationFrame(frame)
      })
      .catch((e) => fail("图片/遮罩加载失败（跨域 CORS 或 404？）: " + ((e as Error)?.message || e)))

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null
    ro?.observe(wrap)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro?.disconnect()
      wrap.removeEventListener("pointermove", onPointer)
      wrap.removeEventListener("pointerdown", onPointer)
      wrap.removeEventListener("pointerleave", onLeave)
      wrap.removeEventListener("pointercancel", onLeave)
      wrap.removeEventListener("pointerup", onLeave)
      try {
        glc.deleteTexture(texImg); glc.deleteTexture(texDepth)
        glc.deleteBuffer(buf); glc.deleteProgram(prog)
        // ⚠️ 不要在此 loseContext()。reactStrictMode(next.config.mjs 开启) dev 下会
        // 「挂载→卸载→再挂载」同一组件、复用同一 canvas/ref；若 cleanup 销毁了上下文，
        // 第二次挂载 getContext 拿回的是死上下文 → 着色器编译必败（infoLog 空、报 "shader"，
        // 表现为「demo 正常、站内永远回退静态图」）。资源已逐个 delete，上下文交给 GC
        // （canvas 卸载后浏览器自动回收；超过上限时浏览器丢弃最旧的，即已关闭的帖子）。
      } catch { /* noop */ }
    }
  }, [src, maskSrc, strength])

  return (
    <div ref={wrapRef} className={cn("absolute inset-0 w-full h-full", className)} style={{ touchAction: "none" }}>
      {(!ready || failed) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={fallbackSrc || src}
          alt={alt || ""}
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
        />
      )}
      {!failed && (
        <canvas
          ref={canvasRef}
          className={cn(
            "absolute inset-0 w-full h-full",
            !isApp && "transition-opacity duration-300",
            ready ? "opacity-100" : "opacity-0",
          )}
          style={{ display: "block" }}
        />
      )}
    </div>
  )
}
