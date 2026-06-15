"use client"

import { useEffect, useMemo, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { usePlaybackTime } from "../_context/PlaybackContext"
import type { LyricLine } from "../_lib/lyrics"

// 歌词 echo 堆叠：当前行贴着面板边缘出现，旧行向外（上方堆往上、下方堆往下）
// 推开，距离越远越透明、越压扁、越模糊(非安卓) —— 参考"文字层叠残影"视觉。上下两侧
// 是同一份历史的镜像。
//
// 桌面端再叠一层「流动水波」(water=true)：照搬 time_line 项目 hover 帖子的水面扭曲——
// SVG feTurbulence(fractalNoise, numOctaves=2) + feDisplacementMap，JS rAF 持续摆动
// baseFrequency 让水在流动；位移 scale 按「离卡片越远越强」分档（见 WaterFilters）。
// 播放时水流满速、暂停时渐静（intensity 缓动）。
// 移动端(含安卓)不挂：调用方按 !isMobile 传 water=false——安卓 WebView 动画化 filter
// 有合成器撕裂前科，且这是桌面增强。water=false 时退回纯 transform+opacity 残影。

const DEPTH = 5 // 每侧可见行数（含当前行）
const ENTER_EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1]
const WATER_LEVELS = 3 // 仅 d=1..3 挂水波；d=0 清晰、d>=4 太淡(透明~0.12)只留模糊不挂水波——
// 那是最贵(scale/区域最大)又最看不见的一档，且正好是「即将消失」的行，省掉它最划算。
// 各档位移幅度(px)：越远越强，末档≈原 18 的力度。
const WATER_SCALE = [6, 11, 17]

// 流动水波滤镜组：每档一个 feTurbulence + feDisplacementMap，纹理参数与参考项目一致
// （fractalNoise / 0.014,0.020 / numOctaves=2），仅位移 scale 随档位递增。
// feTurbulence 带 id，供 rAF 每帧改写 baseFrequency 做流动。
function WaterFilters() {
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute", width: 0, height: 0 }}>
      <defs>
        {WATER_SCALE.map((scale, i) => {
          const level = i + 1 // 1..4
          return (
            <filter
              key={level}
              id={`lyric-water-${level}`}
              x="-15%"
              y="-50%"
              width="130%"
              height="200%"
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence
                id={`lw-turb-${level}`}
                type="fractalNoise"
                baseFrequency="0.014 0.020"
                numOctaves={2}
                seed={2}
                result="noise"
              />
              <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale={scale}
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          )
        })}
      </defs>
    </svg>
  )
}

export function LyricsEcho({
  lines,
  compact,
  water,
  playing,
  isAndroid,
}: {
  lines: LyricLine[]
  compact: boolean
  /** 桌面端开启流动水波（移动端 false → 纯残影）。 */
  water: boolean
  /** 播放中水流满速、暂停渐静。 */
  playing: boolean
  /** 安卓不挂纵深模糊（动画化 filter 撕裂前科；模糊本身是静态、但沿用原门控）。 */
  isAndroid: boolean
}) {
  const { currentTime } = usePlaybackTime()
  const playingRef = useRef(playing)
  playingRef.current = playing

  // currentTime 节流 ~240ms，补半个周期让换行体感更准。
  const t = currentTime + 0.12
  let active = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= t) active = i
    else break
  }

  const visible = useMemo(() => {
    const out: Array<{ key: number; text: string; d: number }> = []
    for (let d = 0; d < DEPTH; d++) {
      const i = active - d
      if (i < 0) break
      out.push({ key: i, text: lines[i].text, d })
    }
    return out
  }, [lines, active])

  // 流动：摆动各水波档的 baseFrequency（参考项目同款）。性能要点——动画化 SVG 滤镜的真正
  // 开销是「baseFrequency 一变，浏览器就为每个用该滤镜的元素重算一遍 fractalNoise」，所以：
  //   ① 写入节流到 ~30fps（重算次数减半，慢流动看不出差别）；
  //   ② 暂停且水面已静时彻底停写 → 滤镜变静态、浏览器缓存结果不再每帧重算（idle 近零开销）。
  useEffect(() => {
    if (!water) return
    let raf = 0
    let phase = 0
    let intensity = playingRef.current ? 1 : 0.15
    let last = performance.now()
    let lastWrite = 0
    const turbs: Element[] = []
    const loop = (now: number) => {
      if (turbs.length === 0) {
        for (let l = 1; l <= WATER_LEVELS; l++) {
          const el = document.getElementById(`lw-turb-${l}`)
          if (el) turbs.push(el)
        }
      }
      const dt = Math.min(50, now - last)
      last = now
      const target = playingRef.current ? 1 : 0.15
      intensity += (target - intensity) * 0.05
      phase += 0.012 * (dt / 16.7) * (0.25 + 0.75 * intensity) // 帧率无关推进
      // 仍在流动(播放中，或暂停后水面尚未静)才写，且节流 ~30fps；静止后停写=滤镜冻结。
      const stillFlowing = playingRef.current || intensity > 0.25
      if (stillFlowing && now - lastWrite >= 33) {
        lastWrite = now
        const fx = (0.014 + Math.sin(phase) * 0.006).toFixed(4)
        const fy = (0.02 + Math.cos(phase * 0.8) * 0.006).toFixed(4)
        const bf = `${fx} ${fy}`
        for (const el of turbs) el.setAttribute("baseFrequency", bf)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [water])

  const gap = compact ? 26 : 34

  return (
    <>
      {water && <WaterFilters />}
      {active >= 0 && (
        <>
          <Stack side={-1} items={visible} gap={gap} water={water} compact={compact} isAndroid={isAndroid} />
          <Stack side={1} items={visible} gap={gap} water={water} compact={compact} isAndroid={isAndroid} />
        </>
      )}
    </>
  )
}

function Stack({
  side, // -1 = 面板上方（往上滚），1 = 面板下方（往下滚）
  items,
  gap,
  water,
  compact,
  isAndroid,
}: {
  side: -1 | 1
  items: Array<{ key: number; text: string; d: number }>
  gap: number
  water: boolean
  compact: boolean
  isAndroid: boolean
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0"
      style={
        side === -1
          ? { bottom: "100%", marginBottom: gap * 0.6, height: 0 }
          : { top: "100%", marginTop: gap * 0.6, height: 0 }
      }
    >
      <AnimatePresence>
        {items.map(({ key, text, d }) => {
          const opacity = Math.max(0, 1 - d * 0.22)
          // 纵深模糊（原本就有，非安卓、静态）+ 流动水波（桌面）串联；当前行 d=0 既不糊也不扭。
          // 顺序 blur→url：先按纵深糊掉，水波再扭这份已糊的文字 → 远处歌词「又糊又荡」像沉在水里。
          const blur = !isAndroid && d > 0 ? `blur(${d * 0.8}px)` : ""
          // 水波只挂到 d<=WATER_LEVELS(3)；最远/即将消失的行(d>=4)只留模糊、不挂动画化滤镜。
          const wave = water && d > 0 && d <= WATER_LEVELS ? `url(#lyric-water-${d})` : ""
          const filter = [blur, wave].filter(Boolean).join(" ") || undefined
          return (
            <motion.div
              key={key}
              className={`absolute inset-x-0 whitespace-nowrap px-4 text-center font-bold text-white ${
                compact ? "text-base" : "text-2xl"
              } ${d === 0 ? "overflow-hidden text-ellipsis" : ""}`}
              style={{
                // 上方堆以底边对齐面板、下方堆以顶边对齐面板。
                ...(side === -1 ? { bottom: 0 } : { top: 0 }),
                textShadow: "0 2px 18px rgba(0,0,0,0.55)",
                filter,
              }}
              initial={{
                opacity: 0,
                y: side * gap * -0.7,
                scaleX: 1,
                scaleY: 1,
              }}
              animate={{
                opacity,
                y: side * d * gap,
                scaleX: 1 - d * 0.06,
                scaleY: 1 - d * 0.16,
              }}
              exit={{
                opacity: 0,
                y: side * DEPTH * gap,
                scaleX: 1 - DEPTH * 0.06,
                scaleY: 1 - DEPTH * 0.16,
              }}
              transition={{ duration: 0.5, ease: ENTER_EASE }}
            >
              {text}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
