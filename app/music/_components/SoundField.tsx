"use client"

import { motion } from "framer-motion"

/**
 * 水波场（Ripple Field）：在详情页「整页」的左右两侧，各从视口边缘的纵向中点向画面
 * 中央荡开一组细密同心水波纹，把居中的播放卡片框在中间 —— 参考"水波"的柔和质感。
 *
 * ⚠️ 这不是真实频谱：meting 音源跨域，Web Audio 的 AnalyserNode 取不到 PCM
 * （画布被污染 / 返回静音），所以是装饰性合成律动，只跟随播放/暂停，不跟随实际频率。
 *
 * 不闪动的关键（上一版"声波"会一脉一脉地闪）：
 *  - 缓动用 linear（匀速外扩）：环间距均匀、每道是对称的三角形亮度包络，多道等相位
 *    错开叠加后「总亮度恒定」—— 不再有 easeOut 造成的忽明忽暗脉动；
 *  - 环数加到 7、峰值降到 0.5：更密更柔、覆盖更连续，单道淡入淡出被邻道补上。
 *
 * 性能（安卓 WebView 友好，规避本项目历史坑）：
 *  - 每道环只动 transform:scale + opacity —— 合成线程最省的两个属性；
 *  - 柔光来自 radial-gradient，绝不用 filter:blur（动画化 filter 叠 backdrop-filter
 *    会撕裂 backing buffer）也不用 box-shadow（每帧重绘是卡顿真凶）；
 *  - 暂停 / reduced-motion 即切静止态，framer-motion 停掉 rAF 循环 —— 空闲零开销。
 */

const RINGS = 7 // 每侧并发水波数（越多越密；每道是一个合成层，仍极廉价）
const DURATION = 6.5 // s，单道水波"自中心荡到外缘"的时长（越大越慢越静）
const REACH = 0.72 // 水波尺度 = 视口宽 × 此系数；越大越往画面中央荡

export function SoundField({
  hue,
  active,
  reducedMotion,
  vw,
}: {
  hue: number
  /** 正在播放才荡漾；否则静止为几道嵌套淡波纹（像水面归于平静）。 */
  active: boolean
  reducedMotion: boolean
  /** 视口宽度，用来定水波尺度（响应式）。 */
  vw: number
}) {
  const animate = active && !reducedMotion
  const D = vw * REACH
  // closest-side 让百分比以"到最近边"为基准，得到一道干净的内切细环（而非贴到角）。
  // 较细的柔带（62%→81%，峰值 71%），7 道错相叠加即细密水波纹。亮度 76% 保证在
  // 桌面端那面彩色封面墙背景上也能看见（弧色与封面同色相时尤其需要）。
  const band = `radial-gradient(circle closest-side at center, transparent 62%, hsl(${hue} 90% 76% / 0.9) 71%, transparent 81%)`

  return (
    <div
      aria-hidden
      // 覆盖全屏；overflow-hidden 防止伸出视口的圆撑出滚动条。
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <Cluster side="left" D={D} band={band} animate={animate} />
      <Cluster side="right" D={D} band={band} animate={animate} />
    </div>
  )
}

function Cluster({
  side,
  D,
  band,
  animate,
}: {
  side: "left" | "right"
  D: number
  band: string
  animate: boolean
}) {
  // 把 D×D 的方框中心对到视口左/右边缘的纵向中点（用 margin 定位，避免占用
  // transform —— transform 留给水波自身做缩放，互不打架）。
  const anchor =
    side === "left"
      ? { left: 0, marginLeft: -D / 2 }
      : { right: 0, marginRight: -D / 2 }

  return (
    <div
      className="absolute"
      style={{ top: "50%", width: D, height: D, marginTop: -D / 2, ...anchor }}
    >
      {Array.from({ length: RINGS }).map((_, i) => {
        const rest = 0.22 + i * 0.15 // 静止时由内到外的几道嵌套淡波纹
        return (
          <motion.div
            key={i}
            className="absolute inset-0 rounded-full"
            style={{ background: band, transformOrigin: "center" }}
            // 必须用「显式 initial」，不能用 initial={false}：后者会让循环关键帧动画
            // 在挂载时不自启动、只有 animate 的值变化时才跑 —— 表现为「歌曲一开播看不到，
            // 必须先暂停一次再播才出现」（本 bug 根因）。给一个等于动画起点的显式 initial，
            // 强制挂载即跑循环；又因与首帧完全相同，不产生跳变 / 不闪。
            initial={animate ? { scale: 0.16, opacity: 0 } : { scale: rest, opacity: 0.2 }}
            animate={
              animate
                ? { scale: [0.16, 1.3], opacity: [0, 0.5, 0] }
                : { scale: rest, opacity: 0.2 }
            }
            transition={
              animate
                ? {
                    duration: DURATION,
                    // linear = 匀速外扩，环间距均匀 + 对称亮度包络 → 多道叠加总亮度
                    // 恒定、不脉动（这是上一版"声波"会闪的根因，已修）。
                    ease: "linear",
                    repeat: Infinity,
                    // 等间隔错相，让任一时刻都同时存在 RINGS 道不同半径的波纹 = 同心。
                    delay: (i * DURATION) / RINGS,
                  }
                : { duration: 0.6, ease: "easeOut" }
            }
          />
        )
      })}
    </div>
  )
}
