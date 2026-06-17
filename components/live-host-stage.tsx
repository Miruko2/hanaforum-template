"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { type HanakoEmotion, EMOTION_COLORS } from "@/lib/hanako/constants"

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

  useEffect(() => {
    if (!reply) {
      setChars([])
      charsRef.current = []
      return
    }

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

      // 全部解码完毕，停止
      if (index >= reply.length && charsRef.current.every((c) => !c.isGlitch)) {
        clearInterval(timerRef.current!)
      }
    }, typeInterval)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
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

      {/* 气泡 */}
      <AnimatePresence>
        {(chars.length > 0 || isThinking) && (
          <motion.div
            className="live-host-bubble"
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -5, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            style={{ borderColor: `${glowColor}40` }}
          >
            {isThinking ? (
              <GlitchThinking />
            ) : (
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
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
