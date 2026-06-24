"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { type HanakoEmotion, EMOTION_COLORS } from "@/lib/hanako/constants"
import { MOOD_FACES, MOOD_FACE_ROWS } from "@/lib/hanako/mood-faces"

interface GlitchChar {
  target: string
  display: string
  isGlitch: boolean
  addedAt: number
}

const GLITCH_POOL = "@#$%&!*~^<>{}[]|/\\ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇｸﾌｺｲﾖﾁﾔﾛｳﾝ"
const GLITCH_DURATION = 2000
const GLITCH_INTERVAL = 40
const TYPE_INTERVAL = 80

const THINK_POOL = "@#$%&!*~^<>{}[]|/\\:;ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ"

function GlitchThinking() {
  const [chars, setChars] = useState("...")

  useEffect(() => {
    const timer = setInterval(() => {
      let s = ""
      for (let i = 0; i < 8; i++) {
        s += THINK_POOL[Math.floor(Math.random() * THINK_POOL.length)]
      }
      setChars(s)
    }, 60)
    return () => clearInterval(timer)
  }, [])

  return <span className="live-host-thinking-glitch">{chars}</span>
}

/** 点阵颜文字「心情脸」：按当前情绪取一整条颜文字点阵，铺成发光珠网格，
 *  发光色由情绪注入（--mood-color）。各条宽度不同，按容器宽度自适应灯珠尺寸，
 *  保证整条颜文字都完整显示。 */
// 心情脸统一发光色：用户指定全部用「害羞」那个粉色（不再随情绪变色；表情形状仍各不相同）
const MOOD_GLOW = "#f9a8d4"

function MoodFace({ emotion }: { emotion: HanakoEmotion }) {
  const rows = MOOD_FACES[emotion] ?? MOOD_FACES.neutral
  const color = MOOD_GLOW
  const cols = rows[0]?.length ?? 1
  const fitRef = useRef<HTMLDivElement>(null)
  const [dot, setDot] = useState(5)

  // 各条颜文字宽度不同：按容器宽度算灯珠尺寸（封顶 6px 不让短条过大、保底 2px 仍可见），
  // 让长条（带片假名尾巴的）也能整条塞进画面。容器尺寸变化时重算。
  useEffect(() => {
    const el = fitRef.current
    if (!el) return
    const GAP = 1
    const recompute = () => {
      const w = el.clientWidth || 1
      const d = Math.max(2, Math.min(6, (w - (cols - 1) * GAP) / cols))
      setDot(d)
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cols])

  return (
    <div
      className="live-host-mood"
      style={{ ["--mood-color" as any]: color }}
      aria-hidden
    >
      <div className="live-host-mood-fit" ref={fitRef}>
        <div
          className="live-host-mood-grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, ${dot}px)`,
            gridTemplateRows: `repeat(${MOOD_FACE_ROWS}, ${dot}px)`,
          }}
        >
          {rows.flatMap((line, r) =>
            line.split("").map((ch, c) => {
              const on = ch === "1"
              // 稀疏「坏灯珠」忽明忽暗：按位置哈希挑约 1/5 的亮珠，各自错开延迟/时长，
              // 像真 LED 屏偶尔有几颗灯一会熄灭一会发光（确定性哈希，不用随机，SSR 安全）
              const seed = (r * 31 + c * 17) & 0xff
              const flick = on && seed % 5 === 0
              return (
                <span
                  key={`${r}-${c}`}
                  className={`live-host-mood-dot${on ? " on" : ""}${
                    flick ? " flick" : ""
                  }`}
                  style={
                    flick
                      ? {
                          animationDelay: `${(seed % 50) / 10}s`,
                          animationDuration: `${2.4 + (seed % 7) * 0.3}s`,
                        }
                      : undefined
                  }
                />
              )
            }),
          )}
        </div>
      </div>
      <span className="live-host-mood-label">MOOD</span>
    </div>
  )
}

interface LiveHostStageProps {
  emotion: HanakoEmotion
  reply: string
  isThinking?: boolean
}

export default function LiveHostStage({
  emotion,
  reply,
  isThinking = false,
}: LiveHostStageProps) {
  const [chars, setChars] = useState<GlitchChar[]>([])
  const charsRef = useRef<GlitchChar[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  // 是否处于「说话」态（气泡显示）。一条回复解码完后停留片刻即转 false，
  // 状态区淡回心情脸。原文恒已写入 live_comments、在左侧弹幕流可见，丢气泡不丢信息。
  const [showReply, setShowReply] = useState(false)
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // 换回复时先清掉上一条的「停留→淡回心情脸」定时器
    if (dismissRef.current) {
      clearTimeout(dismissRef.current)
      dismissRef.current = null
    }

    if (!reply) {
      setChars([])
      charsRef.current = []
      setShowReply(false)
      return
    }

    // 新回复进入「说话」态（气泡显示）
    setShowReply(true)

    if (timerRef.current) clearInterval(timerRef.current)

    const pool = GLITCH_POOL
    // hanako 现在可以回更长内容。长回复时：打字更快、每拍多吐几个字、
    // 乱码持续更短——否则一条长回复的解码动画会拖到十几秒，且 Android
    // WebView 上逐字重渲染过多 span 容易卡。短回复保持原本的逐字仪式感。
    const long = reply.length > 90
    const typeInterval = long ? 16 : GLITCH_INTERVAL
    const glitchDuration = long ? 700 : GLITCH_DURATION
    const charsPerTick = long ? 3 : 1
    let index = 0
    charsRef.current = []
    setChars([])

    // 单一 interval：打字 + 乱码 + 解码
    timerRef.current = setInterval(() => {
      const now = Date.now()

      // 打出接下来的若干字符（长回复一次多吐几个）
      for (
        let k = 0;
        k < charsPerTick && index < reply.length && index === charsRef.current.length;
        k++
      ) {
        charsRef.current = [
          ...charsRef.current,
          {
            target: reply[index],
            display: pool[Math.floor(Math.random() * pool.length)],
            isGlitch: true,
            addedAt: now,
          },
        ]
        index++
      }

      // 乱码闪烁 + 到时解码
      charsRef.current = charsRef.current.map((c) => {
        if (!c.isGlitch) return c
        if (now - c.addedAt >= glitchDuration) {
          return { ...c, display: c.target, isGlitch: false }
        }
        return {
          ...c,
          display: pool[Math.floor(Math.random() * pool.length)],
        }
      })

      setChars([...charsRef.current])

      // 全部解码完毕，停止；停留片刻后淡回心情脸（停留时长随回复长短，封顶 12s）
      if (index >= reply.length && charsRef.current.every((c) => !c.isGlitch)) {
        clearInterval(timerRef.current!)
        const hold = Math.min(12000, 4000 + reply.length * 40)
        dismissRef.current = setTimeout(() => setShowReply(false), hold)
      }
    }, typeInterval)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (dismissRef.current) clearTimeout(dismissRef.current)
    }
  }, [reply])

  const glowColor = EMOTION_COLORS[emotion]
  const videoRef = useRef<HTMLVideoElement>(null)

  return (
    <div className="live-host-stage">
      {/* 背景装饰 */}
      <div className="live-host-bg" aria-hidden>
        <div className="live-host-bg-gradient" />
        <div className="live-host-bg-grid" />
        <div className="live-host-bg-orb live-host-bg-orb-1" />
        <div className="live-host-bg-orb live-host-bg-orb-2" />
        <div className="live-host-bg-orb live-host-bg-orb-3" />
        <div className="live-host-bg-orb live-host-bg-orb-4" />
        <div className="live-host-bg-particle live-host-bg-particle-1" />
        <div className="live-host-bg-particle live-host-bg-particle-2" />
        <div className="live-host-bg-particle live-host-bg-particle-3" />
        <div className="live-host-bg-particle live-host-bg-particle-4" />
        <div className="live-host-bg-particle live-host-bg-particle-5" />
        <div className="live-host-bg-particle live-host-bg-particle-6" />
      </div>

      {/* 角色视频 */}
      <div className="live-host-character">
        <video
          ref={videoRef}
          src="/ascii_hanako_live_pink.mp4"
          autoPlay
          loop
          muted
          playsInline
          className="live-host-video"
        />
      </div>

      {/* 名牌 */}
      <div className="live-host-nameplate">
        <span className="live-host-name">hanako</span>
        <span className="live-host-badge">AI</span>
      </div>

      {/* 状态区：思考→乱码气泡，回复→文字气泡，其余→点阵心情脸。
          三态在同一处交替；说完话停留片刻后淡回心情脸。 */}
      <AnimatePresence mode="wait" initial={false}>
        {isThinking ? (
          <motion.div
            key="thinking"
            className="live-host-bubble"
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            style={{ borderColor: `${glowColor}40` }}
          >
            <GlitchThinking />
          </motion.div>
        ) : showReply ? (
          <motion.div
            key="reply"
            className="live-host-bubble"
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            style={{ borderColor: `${glowColor}40` }}
          >
            <span className="live-host-reply-text">
              {chars.map((c, i) => (
                <span
                  key={i}
                  className={c.isGlitch ? "live-host-glitch-char" : ""}
                >
                  {c.display}
                </span>
              ))}
            </span>
          </motion.div>
        ) : (
          <motion.div
            key="mood"
            className="live-host-mood-wrap"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.3 }}
          >
            <MoodFace emotion={emotion} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
