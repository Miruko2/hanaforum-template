"use client"

import { useCallback, useEffect, useRef } from "react"
import type { LiquidFx, LiquidBg } from "../_context/PlaybackContext"
import { apiUrl } from "@/lib/api-base"
import { cdnUrl } from "@/lib/cdn-url"
import { neteaseDirectCover } from "../_lib/neteasePic"

/**
 * 桌面端液面折射背景（WebGL / Three.js）。
 *
 * 引擎来自自托管的 `public/vendor/liquid1.min.js`（threejs-components@0.0.30 的
 * liquid1 预构建包，three r181 已烤进去，~513KB）。**自托管而非 CDN**：原作从
 * jsdelivr 远程 import，国内会被墙/超时；改成从本站同源 `/vendor/` 懒加载，运行时
 * 不碰外网（已核实该文件无任何外部资源拉取）。
 *
 * 仅桌面端挂载（调用方按 useIsMobile 门控）：这是全屏 WebGL 折射着色器，对低配安卓
 * WebView 太重、且无低配机可测，故安卓/手机不挂背景律动（详情页仅暗化遮罩 + 卡片）。
 *
 * 折射的底图（bgMode 三选，底部播放器切换、持久化）：
 *   · gradient（默认）—— 按当前曲目 hue 现画的「深色 + 同色相柔光」渐变（README 推荐的
 *     高对比深色底），同源 dataURL。
 *   · cover —— 当前曲目封面；background —— 个人首页背景图。
 * 关键：跨域图片直接当 WebGL 纹理会污染、抛安全错。故图片底图统一「先合成到自家同源
 * canvas（压暗 + 高斯模糊 + 同色相柔光，保持折射友好的高对比，又能隐约认出是哪张图）→
 * toDataURL → loadImage」，全程同源，绕开纹理污染，也不依赖引擎内部的 crossOrigin 处理。
 * 取图的 CORS：网易封面（126.net 无 CORS）走同源 /api/img-proxy；自有 CDN 封面 / 首页
 * 背景（ACAO:*）带 crossOrigin 直取。任一步失败 → 回落渐变，水波永不空白。
 *
 * 生命周期：详情页打开才挂载、关闭即 dispose（停 rAF、释放 WebGL 上下文）。
 * reactStrictMode 会在 dev 双调用 effect —— 用 cancelled 标志确保第一份在 import
 * 落地后立刻自我 dispose，不泄漏第二个 GL 上下文。
 */

// 用变量而非字面量做 import specifier：① 让 TS 不去解析这个运行时才存在的模块、
// ② 配合 webpackIgnore 让 webpack 原样保留为浏览器原生动态 import（不打包 three）。
const VENDOR_URL = "/vendor/liquid1.min.js"

// 自动律动模式由运行时 prop `mode`（LiquidFx）决定，底部播放器的切换按钮控制、
// 持久化在 PlaybackContext：
//   "rain"   下雨 —— 引擎内部雨滴，密度=音量基线×呼吸律动。
//   "center" 中间冒泡 —— 合成 pointer 在画面中心绕小圈，持续从中心荡出涟漪。
//   "off"    默认 —— 不自动律动，只保留真实鼠标交互。
// center 占用合成 pointer，真实鼠标移动时让位；rain 是独立的内部雨滴系统。

// 下雨模式雨量范围（滴/秒）：音量 0→1 把雨量基线在此区间线性铺开。
const RAIN_MIN = 4 // 静音：细雨（不死寂）
const RAIN_MAX = 30 // 满音量：倾盆（呼吸律动会在基线上再 ±30% 涨落，峰值≈39）

type LiquidApp = {
  loadImage: (url: string) => void
  setRain: (on: boolean) => void
  setRainTime?: (t: number) => void // 雨滴间隔(秒)，越小越密——可挂音量做密度反应
  dispose?: () => void
  liquidPlane: {
    material: { metalness: number; roughness: number }
    uniforms: { displacementScale: { value: number } }
    /** 在归一化坐标 [-1,1]（x 右正、y 上正、中心 0,0）加一处涟漪。 */
    addDrop?: (x: number, y: number, radius: number, strength: number) => void
  }
}

/** 按 hue 现画一张深色折射底图（同源 dataURL，避免封面跨域污染纹理）。 */
function makeGradient(hue: number): string {
  const w = Math.min(1600, Math.max(640, window.innerWidth))
  const h = Math.min(1000, Math.max(480, window.innerHeight))
  const cv = document.createElement("canvas")
  cv.width = w
  cv.height = h
  const ctx = cv.getContext("2d")
  if (!ctx) return ""

  ctx.fillStyle = "#06070b" // 深色基底
  ctx.fillRect(0, 0, w, h)

  const R = Math.max(w, h)
  const glow = (cx: number, cy: number, r: number, col: string) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, col)
    g.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  // lighter 叠加几团有机柔光：主色 + 邻近色，偏离中心，让画面中央（卡片处）更暗。
  ctx.globalCompositeOperation = "lighter"
  glow(w * 0.26, h * 0.42, R * 0.6, `hsla(${hue}, 85%, 55%, 0.55)`)
  glow(w * 0.8, h * 0.64, R * 0.52, `hsla(${(hue + 40) % 360}, 80%, 50%, 0.4)`)
  glow(w * 0.56, h * 0.16, R * 0.42, `hsla(${(hue + 330) % 360}, 78%, 55%, 0.3)`)
  ctx.globalCompositeOperation = "source-over"

  return cv.toDataURL("image/jpeg", 0.9) // 不透明底，jpeg 更小
}

// ---- 图片底图（cover / background）：先 CORS-safe 取图，再合成到同源 canvas ----

const NETEASE_RE = /(^|\.)music\.126\.net/i

/** 替换/追加网易 CDN 的尺寸参数（不模糊后底图会铺满全屏，取够大才不糊；见 coverLoadUrl）。 */
function withParam(url: string, p: string): string {
  if (/\bparam=\d+y\d+/.test(url)) return url.replace(/\bparam=\d+y\d+/, `param=${p}`)
  return url + (url.includes("?") ? "&" : "?") + `param=${p}`
}

/**
 * 把原始封面 URL 解析成「可被 canvas 读取（不污染）」的加载地址：
 *   · 先 neteaseDirectCover：injahow 跳转 → 网易 CDN 直链；其它原样。
 *   · 网易 126.net（无 CORS）→ 同源 /api/img-proxy（取 1024px：底图不再模糊后会铺满全屏，
 *     小图会糊；代理结果缓存 1 天、且 cover 模式是 opt-in + 仅桌面，增量 egress 有限）。
 *   · 自有 CDN 封面（带 CORS）→ cdnUrl 直取，复用 CF 边缘缓存、不额外烧 Supabase egress
 *     （清晰度取决于上传/存储的原图尺寸：若存的是 _thumb 小图，这里也只能拿到小图）。
 */
function coverLoadUrl(rawCover: string): string | null {
  const direct = neteaseDirectCover(rawCover)
  if (!direct) return null
  if (NETEASE_RE.test(direct)) {
    return apiUrl(`/api/img-proxy?url=${encodeURIComponent(withParam(direct, "1024y1024"))}`)
  }
  return cdnUrl(direct) || direct
}

/** 加载一张 CORS-clean 的图（失败/污染源 → null，调用方回落渐变）。 */
function loadCorsSafeImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** object-fit: cover 方式把图画满画布；overscan 让模糊边缘落到画布外、不留半透明晕。 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  overscan = 1,
): void {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return
  const scale = Math.max(w / iw, h / ih) * overscan
  const dw = iw * scale
  const dh = ih * scale
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

/**
 * 用一张图合成折射底图。
 *
 * 当前＝「压暗不模糊」（用户 2026-06-20 选定）：原图保持锐利、不模糊，仅整体压暗 + 中心再
 * 暗一档（留给卡片），让画面像「水面映着这张图」又不至于太亮抢卡片。失败（如跨域污染）→ null。
 *
 * 备查可调：① 整体亮度 = brightness(0.9)，想更暗/更亮改这值；② 中心暗化 scrim(0.3→0.1)；
 * ③ 想要更柔在 filter 里加回 blur(…)（记得给 drawImageCover 加 overscan 让模糊边缘出界）；
 * ④ 想跟歌着色再加回同色相柔光（lighter 叠 hsla）。
 */
function makeImageBase(img: HTMLImageElement): string | null {
  const w = Math.min(1600, Math.max(640, window.innerWidth))
  const h = Math.min(1000, Math.max(480, window.innerHeight))
  const cv = document.createElement("canvas")
  cv.width = w
  cv.height = h
  const ctx = cv.getContext("2d")
  if (!ctx) return null

  // 深色基底仅作背衬：cover 已铺满画布、正常不可见（防极端宽高比留边）。
  ctx.fillStyle = "#06070b"
  ctx.fillRect(0, 0, w, h)

  // 压暗不模糊：原图保持锐利，仅整体轻压暗（filter 包在 save/restore 内，不波及后面的 scrim）。
  ctx.save()
  ctx.filter = "brightness(0.9)"
  drawImageCover(ctx, img, w, h)
  ctx.restore()

  // 径向暗化（轻）：中心（卡片处）略暗、边缘几乎不动，留一点折射对比。
  const scrim = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.72)
  scrim.addColorStop(0, "rgba(6,7,11,0.3)")
  scrim.addColorStop(1, "rgba(6,7,11,0.1)")
  ctx.fillStyle = scrim
  ctx.fillRect(0, 0, w, h)

  try {
    return cv.toDataURL("image/jpeg", 0.92)
  } catch {
    // 万一图源仍污染了画布（如代理意外返回非同源/无 CORS）→ 回落渐变。
    return null
  }
}

/** 按 bgMode 取对应图源、合成折射底图（gradient / 无图 / 失败 → null，调用方铺渐变）。 */
async function buildImageBaseFor(
  mode: LiquidBg,
  coverUrl: string | null,
  userBgUrl: string | null,
): Promise<string | null> {
  let loadUrl: string | null = null
  if (mode === "cover") loadUrl = coverUrl ? coverLoadUrl(coverUrl) : null
  else if (mode === "background") loadUrl = userBgUrl // 已是带 CORS 的自有 CDN 直链
  if (!loadUrl) return null
  const img = await loadCorsSafeImage(loadUrl)
  if (!img) return null
  return makeImageBase(img)
}

export function LiquidRefraction({
  hue,
  playing,
  volume,
  getIntensity,
  mode,
  bgMode,
  coverUrl,
  userBgUrl,
}: {
  hue: number
  /** 正在播放才自动起波；暂停则水面归于平静。 */
  playing: boolean
  /** 音量设置 [0,1]：越大波越大。注：跨域音源取不到真实响度，这里用音量设置近似。 */
  volume: number
  /** 既有合成"呼吸"律动 getAudioIntensity（墙也用它）；让波的起伏带音乐感。 */
  getIntensity: () => number
  /** 自动律动模式（底部播放器切换、持久化）：rain 下雨 / center 中间冒泡 / off 默认。 */
  mode: LiquidFx
  /** 底图来源：gradient 纯色渐变 / cover 当前封面 / background 个人首页背景。 */
  bgMode: LiquidBg
  /** 当前曲目封面原始 URL（cover 模式用；内部按网易/自有 CDN 分别处理 CORS）。 */
  coverUrl: string | null
  /** 个人首页背景 URL（background 模式用；已是带 CORS 的自有 CDN 直链）。 */
  userBgUrl: string | null
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const appRef = useRef<LiquidApp | null>(null)
  // 让异步创建分支读到最新 hue，又不把 hue 设成创建 effect 的依赖（避免重建上下文）。
  const hueRef = useRef(hue)
  hueRef.current = hue
  // 自动起波用的高频值走 ref（不进 effect 依赖；组件随父级每帧重渲染时刷新）。
  const playingRef = useRef(playing)
  playingRef.current = playing
  const volumeRef = useRef(volume)
  volumeRef.current = volume
  const getIntensityRef = useRef(getIntensity)
  getIntensityRef.current = getIntensity
  const modeRef = useRef(mode)
  modeRef.current = mode
  // 底图来源相关也走 ref：换歌/换源不重建 WebGL 上下文，applyBase 读最新值即可。
  const bgModeRef = useRef(bgMode)
  bgModeRef.current = bgMode
  const coverUrlRef = useRef(coverUrl)
  coverUrlRef.current = coverUrl
  const userBgUrlRef = useRef(userBgUrl)
  userBgUrlRef.current = userBgUrl
  // 异步合成的版本号：换歌/换源后丢弃过期的 buildImageBaseFor 结果，防止旧图盖新图。
  const baseTokenRef = useRef(0)
  // 是否已喂过至少一张底图（用于「图片模式首帧铺渐变避免空白，后续保留当前画面」）。
  const hasBaseRef = useRef(false)

  // 计算并喂入折射底图。走 ref 读最新输入，故可在「引擎就绪」和「输入变化」两处复用，
  // 且不重建 WebGL 上下文。
  //   · gradient：立即铺渐变。
  //   · cover / background：首帧先铺渐变避免空白；之后保留当前画面（不闪渐变），待新图
  //     异步合成就绪再整张替换；取图/合成失败则回落渐变。token 保证只有最新一次写入生效。
  const applyBase = useCallback(() => {
    const app = appRef.current
    if (!app) return
    const hue = hueRef.current
    const mode = bgModeRef.current
    if (mode === "gradient") {
      app.loadImage(makeGradient(hue))
      hasBaseRef.current = true
      return
    }
    if (!hasBaseRef.current) {
      app.loadImage(makeGradient(hue))
      hasBaseRef.current = true
    }
    const token = ++baseTokenRef.current
    void buildImageBaseFor(mode, coverUrlRef.current, userBgUrlRef.current).then((data) => {
      // 期间又切了歌/换了模式 → 本次结果作废；引擎已卸载也不写。
      if (token !== baseTokenRef.current || !appRef.current) return
      appRef.current.loadImage(data ?? makeGradient(hueRef.current))
    })
  }, [])

  // 创建一次：懒加载引擎 → 建 app → 喂底图 + 设参数。卸载即 dispose。
  useEffect(() => {
    let cancelled = false
    const start = async () => {
      const canvas = canvasRef.current
      if (!canvas) return
      try {
        const mod = await import(/* webpackIgnore: true */ VENDOR_URL)
        if (cancelled || !canvasRef.current) return
        const LiquidBackground = mod.default as (c: HTMLCanvasElement) => LiquidApp
        const app = LiquidBackground(canvasRef.current)
        try {
          app.liquidPlane.material.metalness = 0.35
          app.liquidPlane.material.roughness = 0.45
          app.liquidPlane.uniforms.displacementScale.value = 2
          app.setRain(false)
        } catch {
          /* 参数面板结构变化时不致命，效果仍在 */
        }
        if (cancelled) {
          app.dispose?.()
          return
        }
        appRef.current = app
        // 引擎就绪：按当前来源铺底图（gradient 同步、cover/background 再异步合成替换）。
        applyBase()
      } catch {
        /* 桌面增强项：引擎/WebGL 不可用时静默降级（背景仍是遮罩） */
      }
    }
    void start()
    return () => {
      cancelled = true
      appRef.current?.dispose?.()
      appRef.current = null
    }
  }, [applyBase])

  // 换歌（hue / 封面变）、换底图来源（bgMode）、换首页背景：重算底图，不重建 WebGL 上下文。
  useEffect(() => {
    applyBase()
  }, [bgMode, coverUrl, userBgUrl, hue, applyBase])

  // 自动律动：一个 rAF 轮询，按运行时 `mode`（modeRef）单选驱动一种（值走 ref，不重建上下文）。
  //   rain   —— 引擎内部雨滴，密度=音量基线×呼吸律动；切到别的模式会确保雨关掉。
  //   center —— 直接 addDrop 在卡片四周的环上撒多处涟漪（不经合成 pointer，故不被卡片
  //             遮住、能看见；与真实鼠标互不干扰）。撒点速率/强度随 音量×呼吸 增大。
  //   off    —— 不自动律动（调用方在 off 时根本不挂载本组件，这里是兜底）。
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let raf = 0
    let last = performance.now()
    let rainOn = false
    let dropAccum = 0 // center：按速率攒够时间就撒一滴
    let dropAngle = 0 // center：黄金角递增，让涟漪均匀散布在卡片四周
    const loop = () => {
      const now = performance.now()
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const playing = playingRef.current
      const app = appRef.current
      const mode = modeRef.current
      const pulse = Math.max(0, Math.min(1, getIntensityRef.current()))
      const vol = Math.max(0, Math.min(1, volumeRef.current))
      const drive = (0.4 + 0.6 * vol) * (0.55 + 0.45 * pulse) // ~0.22..1

      // —— 下雨模式：引擎内部雨滴。非 rain 模式时 wantRain=false → 确保雨关掉 ——
      const wantRain = mode === "rain" && playing
      if (app && wantRain !== rainOn) {
        app.setRain(wantRain) // 仅 rain 模式且播放时下雨；切走模式/暂停即停
        rainOn = wantRain
      }
      if (app && wantRain) {
        // 雨密度 = 音量基线 × 呼吸律动。timeDelta = 滴间隔(秒)，越小越密。
        const base = RAIN_MIN + (RAIN_MAX - RAIN_MIN) * vol
        const rate = Math.max(RAIN_MIN, Math.min(RAIN_MAX, base * (0.7 + 0.6 * pulse)))
        app.setRainTime?.(1 / rate)
      }

      // —— 中间涟漪：一次只一滴。在画面正中（卡片处）小范围（半径 0~0.2）撒单滴，等它
      //    扩散淡去后再撒下一滴 —— 间隔 ~1.7~2.5s（每帧最多一滴），任意时刻只有一圈涟漪。
      //    卡片是半透毛玻璃，中心涟漪透过玻璃柔显、扩散到卡片外的部分清晰可见。
      //    addDrop strength .01~.028（轻）；间隔随 drive（音量×呼吸）略变。——
      if (mode === "center" && playing && app?.liquidPlane.addDrop) {
        dropAccum += dt
        const interval = 1 / (0.4 + 0.2 * drive) // 滴/秒 0.4..0.6 → 间隔 ~2.5~1.7s
        if (dropAccum >= interval) {
          dropAccum = 0
          dropAngle += 2.399963 // 黄金角，让每一滴落在中央小范围内的不同点
          const rr = Math.random() * 0.2
          app.liquidPlane.addDrop(
            Math.cos(dropAngle) * rr,
            Math.sin(dropAngle) * rr,
            0.05,
            0.01 + 0.018 * drive,
          )
        }
      } else {
        dropAccum = 0
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <canvas ref={canvasRef} aria-hidden className="absolute inset-0 block h-full w-full" />
  )
}
