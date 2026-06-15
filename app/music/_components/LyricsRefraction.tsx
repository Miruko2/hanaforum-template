"use client"

import { useEffect, useMemo, useRef } from "react"
import { usePlaybackTime } from "../_context/PlaybackContext"
import type { LyricLine } from "../_lib/lyrics"

/**
 * 详情页歌词「真·流动水折射」（桌面增强，A 方案）。
 *
 * 思路（避免逐帧光栅化文字、避免大依赖）：
 *   1. 把歌词 echo 堆叠画进一张 2D canvas（**仅换行/过渡 0.45s 内**重画，平时静止）。
 *   2. 用一个极小的 raw-WebGL 全屏 quad + 流动位移着色器对这张纹理折射采样：
 *        · 位移场 = 几条随时间滚动的正弦波叠加（像水面波纹在流动）
 *        · 位移强度随「离卡片的垂直距离」增大 —— 贴卡片≈不动保清晰、越远抖得越凶
 *        · 轻微色散(uCA)让笔画边缘有水透光感
 * 单帧成本=一个全屏 quad（便宜）；贵的文字光栅几秒一次。
 *
 * 仅桌面挂载（调用方 !isMobile 门控）：这是第二个 WebGL 上下文，承袭液面折射的「仅桌面」
 * 策略，低配安卓 WebView 太重。可整体回退：调用方开关切回 LyricsEcho(DOM)，本文件可直接删。
 *
 * —— 可调参数都在 FRAG 着色器与下方常量里（位移频率/幅度、uCA 色散、uAmp 总强度、流速）。
 */

const DEPTH = 5 // 每侧可见行数（含当前行），与 LyricsEcho 对齐
const TRANS_MS = 450 // 换行时堆叠向外推开的过渡时长
const U_AMP = 1.0 // 位移总强度
const U_CA = 0.25 // 色散强度（0 关闭）

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uText;
uniform float uTime;
uniform float uCenterY; // 卡片中心 y（uv，≈0.5）
uniform float uHalfY;   // 卡片半高（uv）
uniform float uAmp;
uniform float uFlow;    // 流速（暂停时趋近 0、水面渐静）
uniform float uCA;
void main() {
  // 离卡片的垂直距离 → 位移强度（贴卡片≈0、越远越大、上限 1）
  float dist = max(0.0, abs(vUv.y - uCenterY) - uHalfY);
  float amp = uAmp * clamp(dist * 3.0, 0.0, 1.0);

  // 流动位移：几条滚动正弦波叠加
  float t = uTime * uFlow;
  vec2 off;
  off.x = sin(vUv.y * 26.0 + t * 1.6) * 0.010 + sin(vUv.y * 61.0 - t * 2.3) * 0.005;
  off.y = sin(vUv.x * 22.0 + t * 1.9) * 0.006 + sin(vUv.x * 48.0 - t * 1.3) * 0.003;
  off *= amp;

  // 轻微色散：R/B 通道按位移方向略微错开采样
  vec2 ca = off * uCA;
  vec4 base = texture2D(uText, vUv + off);
  float r = texture2D(uText, vUv + off + ca).r;
  float b = texture2D(uText, vUv + off - ca).b;
  gl_FragColor = vec4(r, base.g, b, base.a);
}`

type Geom = { cssW: number; cssH: number; dpr: number }
type Stat = { lines: LyricLine[]; compact: boolean; panelH: number; playing: boolean }

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed")
  }
  return sh
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  op: number,
  sx: number,
  sy: number,
) {
  ctx.save()
  ctx.globalAlpha = op
  ctx.translate(x, y)
  ctx.scale(sx, sy)
  ctx.shadowColor = "rgba(0,0,0,0.55)"
  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 2
  ctx.fillStyle = "#fff"
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

// 把 echo 堆叠画进文字 canvas。p=过渡进度(0..1)：每行从「上一档深度」平滑外推到当前深度。
function drawText(ctx: CanvasRenderingContext2D, g: Geom, st: Stat, active: number, p: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, g.cssW * g.dpr, g.cssH * g.dpr)
  if (active < 0) return

  const dpr = g.dpr
  const gap = st.compact ? 26 : 34
  const fontPx = (st.compact ? 16 : 24) * dpr
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.font = `700 ${fontPx}px "Hiragino Kaku Gothic ProN","Noto Sans JP","PingFang SC","Microsoft YaHei",system-ui,sans-serif`

  const cx = (g.cssW * dpr) / 2
  const centerY = (g.cssH * dpr) / 2
  const panelHalf = (st.panelH / 2) * dpr
  const edgeGap = gap * 0.6 * dpr
  const gapPx = gap * dpr

  for (let d = 0; d < DEPTH; d++) {
    const i = active - d
    if (i < 0) break
    const text = st.lines[i].text
    const eD = d - (1 - p) // 平滑外推：换行瞬间每行还在「上一档」位置，过渡到当前档
    const op = Math.max(0, 1 - eD * 0.22) * (d === 0 ? p : 1) // 新进入行(d=0)随 p 淡入
    if (op <= 0.01) continue
    const sx = 1 - eD * 0.06
    const sy = 1 - eD * 0.16
    // 上方堆（往上）与下方堆（往下）镜像。
    drawLine(ctx, text, cx, centerY - panelHalf - edgeGap - eD * gapPx, op, sx, sy)
    drawLine(ctx, text, cx, centerY + panelHalf + edgeGap + eD * gapPx, op, sx, sy)
  }
}

export function LyricsRefraction({
  lines,
  compact,
  panelH,
  playing,
}: {
  lines: LyricLine[]
  compact: boolean
  panelH: number
  playing: boolean
}) {
  const { currentTime } = usePlaybackTime()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // 高频值走 ref，不进 rAF 依赖（组件随 currentTime 节流重渲染时刷新）。
  const stateRef = useRef<Stat>({ lines, compact, panelH, playing })
  stateRef.current.lines = lines
  stateRef.current.compact = compact
  stateRef.current.panelH = panelH
  stateRef.current.playing = playing

  // 当前激活行（与 LyricsEcho 同算法：+0.12s 补半个节流周期）。
  const active = useMemo(() => {
    const t = currentTime + 0.12
    let a = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= t) a = i
      else break
    }
    return a
  }, [currentTime, lines])

  const activeRef = useRef(active)
  const transStartRef = useRef(0)

  // 换行：记下过渡起点，rAF 据此推开堆叠。
  useEffect(() => {
    if (active === activeRef.current) return
    activeRef.current = active
    transStartRef.current = performance.now()
  }, [active])

  // 创建一次：建 GL → 编译 → 建纹理/quad → rAF 渲染。卸载即清理（释放上下文）。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const textCanvas = document.createElement("canvas")
    const ctx2d = textCanvas.getContext("2d")
    let gl: WebGLRenderingContext | null = null
    try {
      gl =
        (canvas.getContext("webgl", {
          alpha: true,
          premultipliedAlpha: false,
          antialias: true,
          depth: false,
          stencil: false,
        }) as WebGLRenderingContext | null) || null
    } catch {
      gl = null
    }
    if (!gl || !ctx2d) return

    let raf = 0
    let program: WebGLProgram | null = null
    let tex: WebGLTexture | null = null
    let buf: WebGLBuffer | null = null
    const geomRef: { current: Geom } = { current: { cssW: 1, cssH: 1, dpr: 1 } }
    const flowRef = { current: playing ? 1 : 0.15 }
    const lastPRef = { current: 1 }
    let forceRedraw = true
    const start = performance.now()

    try {
      const vs = compile(gl, gl.VERTEX_SHADER, VERT)
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
      program = gl.createProgram()!
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "link failed")
      }
      gl.useProgram(program)

      // 全屏 quad
      buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      )
      const aPos = gl.getAttribLocation(program, "aPos")
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

      // 文字纹理
      tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1) // canvas 顶行 → 屏幕顶
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0) // 直通 alpha

      const uText = gl.getUniformLocation(program, "uText")
      const uTime = gl.getUniformLocation(program, "uTime")
      const uCenterY = gl.getUniformLocation(program, "uCenterY")
      const uHalfY = gl.getUniformLocation(program, "uHalfY")
      const uAmp = gl.getUniformLocation(program, "uAmp")
      const uFlow = gl.getUniformLocation(program, "uFlow")
      const uCA = gl.getUniformLocation(program, "uCA")
      gl.uniform1i(uText, 0)
      gl.uniform1f(uAmp, U_AMP)
      gl.uniform1f(uCA, U_CA)
      gl.uniform1f(uCenterY, 0.5)
      gl.clearColor(0, 0, 0, 0)

      const resize = () => {
        const dpr = Math.min(2, window.devicePixelRatio || 1)
        const cssW = canvas.clientWidth || window.innerWidth
        const cssH = canvas.clientHeight || window.innerHeight
        canvas.width = Math.max(1, Math.round(cssW * dpr))
        canvas.height = Math.max(1, Math.round(cssH * dpr))
        textCanvas.width = canvas.width
        textCanvas.height = canvas.height
        gl!.viewport(0, 0, canvas.width, canvas.height)
        geomRef.current = { cssW, cssH, dpr }
        forceRedraw = true
      }
      resize()
      window.addEventListener("resize", resize)

      const frame = (now: number) => {
        const time = ((now - start) / 1000) % 1000
        const st = stateRef.current
        const g = geomRef.current

        // 过渡：换行后 TRANS_MS 内逐帧重画文字外推，结束后静止（只剩水在流）。
        const p = Math.min(1, (now - transStartRef.current) / TRANS_MS)
        if (forceRedraw || p < 1 || lastPRef.current < 1) {
          drawText(ctx2d, g, st, activeRef.current, p)
          gl!.bindTexture(gl!.TEXTURE_2D, tex)
          gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, textCanvas)
        }
        lastPRef.current = p
        forceRedraw = false

        // 流速缓动：播放→1、暂停→0.15（水面渐静不全停）。
        const target = st.playing ? 1.0 : 0.15
        flowRef.current += (target - flowRef.current) * 0.05

        gl!.uniform1f(uTime, time)
        gl!.uniform1f(uFlow, flowRef.current)
        gl!.uniform1f(uHalfY, st.panelH / 2 / g.cssH)
        gl!.clear(gl!.COLOR_BUFFER_BIT)
        gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4)
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)

      return () => {
        cancelAnimationFrame(raf)
        window.removeEventListener("resize", resize)
        gl!.deleteProgram(program)
        gl!.deleteTexture(tex)
        gl!.deleteBuffer(buf)
        // 不调用 WEBGL_lose_context.loseContext()：dev 的 React StrictMode 会
        // mount→cleanup→remount，丢上下文会让 remount 拿到已丢失的同一上下文→着色器编
        // 译失败→空白（误判 A 失效）。改为保留上下文供 remount 复用；真正卸载时 portal
        // 移除 canvas，浏览器自会回收脱离文档的 WebGL 上下文。
      }
    } catch {
      // GL/着色器不可用：静默降级（桌面增强项，不致命）。
      cancelAnimationFrame(raf)
      return () => cancelAnimationFrame(raf)
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
