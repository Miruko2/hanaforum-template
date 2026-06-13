"use client"

import { useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { usePlaybackTime } from "../_context/PlaybackContext"
import type { LyricLine } from "../_lib/lyrics"

// 歌词 echo 堆叠：当前行贴着面板边缘出现，旧行向外（上方堆往上、下方堆往下）
// 推开，距离越远越透明、越压扁、越模糊 —— 参考"文字层叠残影"视觉。上下两侧
// 是同一份历史的镜像。安卓 WebView 上动画化 filter:blur 有合成器撕裂前科，
// 故安卓只走 transform+opacity（视觉上靠透明度+压扁近似纵深）。

const DEPTH = 5 // 每侧可见行数（含当前行）
const ENTER_EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1]

export function LyricsEcho({
  lines,
  isAndroid,
  compact,
}: {
  lines: LyricLine[]
  isAndroid: boolean
  compact: boolean
}) {
  const { currentTime } = usePlaybackTime()

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

  if (active < 0) return null

  const gap = compact ? 26 : 34

  return (
    <>
      <Stack side={-1} items={visible} gap={gap} isAndroid={isAndroid} compact={compact} />
      <Stack side={1} items={visible} gap={gap} isAndroid={isAndroid} compact={compact} />
    </>
  )
}

function Stack({
  side, // -1 = 面板上方（往上滚），1 = 面板下方（往下滚）
  items,
  gap,
  isAndroid,
  compact,
}: {
  side: -1 | 1
  items: Array<{ key: number; text: string; d: number }>
  gap: number
  isAndroid: boolean
  compact: boolean
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
          const blur = isAndroid ? undefined : `blur(${d * 1.2}px)`
          return (
            <motion.div
              key={key}
              className={`absolute inset-x-0 overflow-hidden text-ellipsis whitespace-nowrap px-4 text-center font-bold text-white ${
                compact ? "text-base" : "text-2xl"
              }`}
              style={{
                // 上方堆以底边对齐面板、下方堆以顶边对齐面板。
                ...(side === -1 ? { bottom: 0 } : { top: 0 }),
                textShadow: "0 2px 18px rgba(0,0,0,0.55)",
              }}
              initial={{
                opacity: 0,
                y: side * gap * -0.7,
                scaleX: 1,
                scaleY: 1,
                ...(blur !== undefined ? { filter: "blur(0px)" } : {}),
              }}
              animate={{
                opacity,
                y: side * d * gap,
                scaleX: 1 - d * 0.06,
                scaleY: 1 - d * 0.16,
                ...(blur !== undefined ? { filter: blur } : {}),
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
