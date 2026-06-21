"use client"

import { useEffect, useRef } from "react"

/**
 * 音频地形波可视化器（详情页全屏背景，Three.js）。灵感来自 GitHub 上的 sonic-topography
 * （棋盘式海浪），但**为我们自己重写**（原项目无 License，不能照搬代码）。
 *
 * 一张 N×N 的实例化方柱网格（InstancedMesh）：每根方柱按「离中心的半径」映射到一个频段，
 * 中心=低频（鼓/贝斯）→ 高且偏白，边缘=高频 → 矮且偏蓝；整片网格做穹顶下沉 + 指数雾，
 * 边缘自然没入暗色背景，得到图里那种「发光地形浮在球面上」的效果。
 *
 * **仅本地上传歌 + 桌面/iPad 挂载**（调用方 ExpandedCard 已用 shown.local + 非 off/移动端
 * 门控）：本地歌是同源 blob、接了 AnalyserNode 才有真实 FFT（getFrequencies 返回 true）；
 * 在线歌拿不到频谱，调用方根本不挂载（回退默认暗背景）。three 在此处**动态 import**，
 * 只在桌面真正进入地形模式时才加载这块 ~150KB 的 chunk，零首屏成本。
 *
 * 生命周期照搬 LiquidRefraction：挂载即建场景 + rAF，卸载即 dispose（停 rAF、释放 WebGL）。
 */
type Props = {
  /** 填充频谱字节，返回是否为真实数据（见 PlaybackContext.getAudioFrequencies）。 */
  getFrequencies: (out: Uint8Array) => boolean
  /** 当前主色相（0..360），给高处方柱上色调染。 */
  hue: number
  /** 是否正在播放（暂停时方柱缓缓落回平静穹顶）。 */
  playing: boolean
}

// 必须等于 PlaybackContext 里 analyser.frequencyBinCount（fftSize 512 → 256）。
const BINS = 256

// —— 可调参数（真机看效果后微调）——
const GRID = 46 // 每边方柱数（GRID² 个实例；46²≈2116，桌面 GPU 轻松）
const CELL = 1 // 单元间距（世界单位）
const COL_W = 0.72 // 方柱宽度占单元比例（留缝隙＝棋盘感）
const DOME = 7.5 // 穹顶下沉量：边缘比中心低这么多（造球面）
const BASE_H = 0.45 // 静止/边缘的基础高度（让蓝色矮柱场始终可见）
const REACT_H = 8.5 // 中心频段满能量时额外拔高的量
const PEAK_WHITE = 5.5 // 高度到此即接近纯白
const USABLE_BINS = Math.floor(BINS * 0.7) // 高频段常空，只用前 70%

export function AudioTopography({ getFrequencies, hue, playing }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // 高频属性塞进 ref，rAF 每帧读最新值、不重启场景。
  const propsRef = useRef({ getFrequencies, hue, playing })
  propsRef.current = { getFrequencies, hue, playing }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false
    let raf = 0
    // cleanup 钩子，等异步 import 完成后填充；卸载时统一调用。
    let cleanup: (() => void) | null = null

    // three 动态 import：只在本组件（桌面 + 地形模式 + 本地歌）真正挂载时才下载。
    import("three")
      .then((THREE) => {
        if (disposed || !canvasRef.current) return

        const count = GRID * GRID
        const freqBuf = new Uint8Array(BINS)

        // —— 渲染器 ——
        const renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true, // 透明背景，叠在详情页暗化遮罩之上
          antialias: true,
          powerPreference: "high-performance",
        })
        renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1))

        // —— 场景 / 相机 / 雾 ——
        const scene = new THREE.Scene()
        const FOG = new THREE.Color(0x05070f) // 深蓝黑，边缘没入它
        scene.fog = new THREE.FogExp2(FOG.getHex(), 0.019)

        const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)
        camera.position.set(0, 16, 26)
        camera.lookAt(0, -1.5, 0)

        // —— 方柱几何：把原点挪到底面，缩放 Y 即「从地面往上长」——
        const geo = new THREE.BoxGeometry(COL_W, 1, COL_W)
        geo.translate(0, 0.5, 0)
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff }) // 自发光观感，靠 instanceColor 上色
        const mesh = new THREE.InstancedMesh(geo, mat, count)
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        const group = new THREE.Group()
        group.add(mesh)
        scene.add(group)

        // —— 预计算每个单元的静态数据（半径 / 频段 / 穹顶基准 / 不规则系数）——
        const half = (GRID - 1) / 2
        const maxR = Math.hypot(half, half)
        const cellBin = new Int16Array(count)
        const cellEnv = new Float32Array(count) // 中心高、边缘低的包络
        const cellDomeY = new Float32Array(count) // 球面下沉基准 Y
        const cellVary = new Float32Array(count) // 每柱不规则系数（破对称）
        const cellX = new Float32Array(count)
        const cellZ = new Float32Array(count)
        // 便宜的伪随机（确定性，避免 Math.random 每次不同；这里需要的是稳定纹理）
        const hash = (n: number) => {
          const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
          return s - Math.floor(s)
        }
        for (let i = 0; i < GRID; i++) {
          for (let j = 0; j < GRID; j++) {
            const k = i * GRID + j
            const dx = i - half
            const dz = j - half
            const r = Math.hypot(dx, dz)
            const rNorm = r / maxR // 0(中心)..1(角)
            cellX[k] = dx * CELL
            cellZ[k] = dz * CELL
            // 频段：中心=低频，向外升高；加每柱抖动破除完美同心圆
            const jitter = (hash(k) - 0.5) * 0.12
            cellBin[k] = Math.max(
              0,
              Math.min(USABLE_BINS - 1, Math.floor((rNorm + jitter) * USABLE_BINS)),
            )
            // 包络：中心拔高、边缘压平（造中央发光土丘）
            cellEnv[k] = Math.pow(Math.max(0, 1 - rNorm), 1.6)
            // 球面：边缘随 r² 下沉
            cellDomeY[k] = -DOME * rNorm * rNorm
            cellVary[k] = 0.7 + 0.6 * hash(k * 1.7 + 5)
          }
        }

        // 平滑后的高度（EMA，逐柱）
        const heights = new Float32Array(count)

        // 复用对象，避免每帧分配
        const dummy = new THREE.Object3D()
        const cLow = new THREE.Color()
        const cHigh = new THREE.Color()
        const cOut = new THREE.Color()

        // —— resize ——
        const resize = () => {
          const w = Math.max(1, canvas.clientWidth)
          const h = Math.max(1, canvas.clientHeight)
          renderer.setSize(w, h, false)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
        }
        resize()
        window.addEventListener("resize", resize)

        let last = performance.now()
        const loop = () => {
          const now = performance.now()
          const dt = Math.min(0.05, (now - last) / 1000)
          last = now
          const p = propsRef.current
          const real = p.playing && p.getFrequencies(freqBuf)

          // 高处方柱用「白 ← 当前曲 hue 微染」，每帧算一次即可
          cHigh.setHSL((((p.hue % 360) + 360) % 360) / 360, 0.25, 0.92)

          for (let k = 0; k < count; k++) {
            const raw = real ? freqBuf[cellBin[k]] / 255 : 0
            // 边缘恒有矮蓝场（BASE×vary），中心叠加随频段拔高（×包络）
            const target = BASE_H * cellVary[k] + raw * REACT_H * cellEnv[k]
            // 上升快、回落慢（余辉感）
            const cur = heights[k]
            heights[k] = target > cur ? cur + (target - cur) * 0.45 : cur + (target - cur) * 0.12
            const hgt = Math.max(0.04, heights[k])

            dummy.position.set(cellX[k], cellDomeY[k], cellZ[k])
            dummy.scale.set(1, hgt, 1)
            dummy.updateMatrix()
            mesh.setMatrixAt(k, dummy.matrix)

            // 颜色：矮=深蓝（随高度略提亮），高=接近白(微染 hue)
            const t = Math.min(1, hgt / PEAK_WHITE)
            cLow.setHSL(0.6, 0.7, 0.16 + 0.16 * t)
            cOut.copy(cLow).lerp(cHigh, Math.pow(t, 1.4))
            mesh.setColorAt(k, cOut)
          }
          mesh.instanceMatrix.needsUpdate = true
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

          // 极缓慢自转，增加生命感（不喧宾夺主）
          group.rotation.y += dt * 0.04

          renderer.render(scene, camera)
          raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)

        cleanup = () => {
          cancelAnimationFrame(raf)
          window.removeEventListener("resize", resize)
          geo.dispose()
          mat.dispose()
          mesh.dispose()
          renderer.dispose()
          // 立即释放 WebGL 上下文：频繁切换特效模式时避免堆积、撞浏览器 ~16 上下文上限。
          renderer.forceContextLoss()
        }
      })
      .catch(() => {
        /* three 加载失败：静默回退（详情页仍有暗化背景），不影响播放 */
      })

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      if (cleanup) cleanup()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  )
}
