"use client"

import { useEffect, useRef, useState } from "react"
import { usePlaybackWall } from "../_context/PlaybackContext"
import { neteaseDirectCover } from "../_lib/neteasePic"
import type { Track } from "../_data/tracks"

/**
 * Ambient backdrop showing the currently playing track's cover, scaled up,
 * slightly blurred, with three motion sources:
 *   1. Crossfade on track change (two stacked layers, swap opacity 0↔1)
 *   2. Ken Burns — slow pan + scale of the img via CSS @keyframes
 *   3. Audio-reactive pulse — img opacity nudges with audio intensity each frame
 *
 * Layer opacity (0/1) is React-driven for the crossfade.
 * Img opacity (~0.55..1) is rAF-driven for the pulse.
 * Final visible alpha = layerOpacity × imgPulseOpacity × hardcoded 0.85.
 */
type Props = {
  /**
   * Lite tier: skip the expensive `filter: blur(20px)` and the Ken Burns
   * pan/scale animation. On weak GPUs the constant transform invalidates the
   * blur cache every frame, forcing the compositor to re-rasterize a fullscreen
   * blurred bitmap continuously — the single biggest cost on the page.
   * The crossfade between tracks and the audio-reactive opacity pulse are kept.
   */
  lite?: boolean
}

export function CoverBackdrop({ lite = false }: Props = {}) {
  // 墙专用低频上下文：本组件只要 currentTrack + getAudioIntensity，
  // 不该被 volume / history 等高频 value 重建波及（全屏图层重渲染不便宜）。
  const { currentTrack, getAudioIntensity } = usePlaybackWall()

  const [layerA, setLayerA] = useState<Track | null>(null)
  const [layerB, setLayerB] = useState<Track | null>(null)
  const [active, setActive] = useState<"a" | "b">("a")
  const lastIdRef = useRef<string | null>(null)

  const imgRefA = useRef<HTMLImageElement | null>(null)
  const imgRefB = useRef<HTMLImageElement | null>(null)

  // Track-swap crossfade logic (unchanged from before).
  useEffect(() => {
    const newId = currentTrack?.id ?? null
    if (newId === lastIdRef.current) return
    lastIdRef.current = newId

    if (!currentTrack) {
      const inactive = active === "a" ? "b" : "a"
      if (inactive === "a") setLayerA(null)
      else setLayerB(null)
      setActive(inactive)
      return
    }

    const inactive = active === "a" ? "b" : "a"
    if (inactive === "a") setLayerA(currentTrack)
    else setLayerB(currentTrack)

    const img = new window.Image()
    // 与显示用的 <img> 一致：网易 CDN 防盗链，带 referer 会 403；去掉 referer + 转直链，
    // 让预加载成功命中缓存，显示层秒显、crossfade 不闪。
    img.referrerPolicy = "no-referrer"
    img.src = neteaseDirectCover(currentTrack.cover)
    const flip = () => setActive(inactive)
    if (img.complete && img.naturalWidth > 0) flip()
    else {
      img.onload = flip
      img.onerror = flip
    }
  }, [currentTrack, active])

  // Audio-reactive pulse — driven entirely by rAF + refs, never re-renders.
  // 量化到 1% 步进 + 脏检查：原先每帧都写一个新 opacity 字符串（呼吸正弦帧帧不同），
  // 全屏图层每帧失效；更糟的是底部播放器的 backdrop-filter 压在本层上，背景一变
  // 就得整面板重模糊。1% 步进肉眼不可辨，却把写入频率从 60/s 压到 ~20/s；
  // 暂停时 intensity 恒 1 → 脏检查后完全零写入。
  useEffect(() => {
    let mounted = true
    let raf = 0
    let prevPulse = ""
    const loop = () => {
      if (!mounted) return
      const intensity = getAudioIntensity() // 0..1, paused returns 1 (steady)
      // Map intensity → opacity multiplier. At intensity 1: full base opacity.
      // At intensity 0: dimmed to ~0.55. Sweet spot for "breathing" effect.
      const pulse = (0.55 + intensity * 0.45).toFixed(2)
      if (pulse !== prevPulse) {
        if (imgRefA.current) imgRefA.current.style.opacity = pulse
        if (imgRefB.current) imgRefB.current.style.opacity = pulse
        prevPulse = pulse
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      mounted = false
      cancelAnimationFrame(raf)
    }
  }, [getAudioIntensity])

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <Layer track={layerA} visible={active === "a"} imgRef={imgRefA} kbClass={lite ? "" : "cover-kb-a"} lite={lite} />
      <Layer track={layerB} visible={active === "b"} imgRef={imgRefB} kbClass={lite ? "" : "cover-kb-b"} lite={lite} />
      {/* Bottom fade to keep player chrome + hint legible despite the now
          much more dominant cover background. */}
      <div
        className="absolute inset-x-0 bottom-0 h-2/5"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.75), transparent)",
        }}
      />

      {/* Ken Burns keyframes — slow zoom + drift, infinite. We use two
          alternating variants per layer (A vs B) so the two crossfading
          covers aren't moving in lockstep, which would look mechanical. */}
      <style jsx global>{`
        @keyframes coverKenBurnsA {
          0%   { transform: scale(1.10) translate(0%, 0%); }
          50%  { transform: scale(1.20) translate(-2.5%, -1.5%); }
          100% { transform: scale(1.10) translate(0%, 0%); }
        }
        @keyframes coverKenBurnsB {
          0%   { transform: scale(1.13) translate(0%, 0%); }
          50%  { transform: scale(1.22) translate(2%, 1.8%); }
          100% { transform: scale(1.13) translate(0%, 0%); }
        }
        .cover-kb-a { animation: coverKenBurnsA 55s ease-in-out infinite; }
        .cover-kb-b { animation: coverKenBurnsB 50s ease-in-out infinite; }
      `}</style>
    </div>
  )
}

function Layer({
  track,
  visible,
  imgRef,
  kbClass,
  lite,
}: {
  track: Track | null
  visible: boolean
  imgRef: React.MutableRefObject<HTMLImageElement | null>
  kbClass: string
  lite: boolean
}) {
  return (
    <div
      className="absolute inset-0 transition-opacity duration-700 ease-out"
      style={{ opacity: visible && track ? 0.85 : 0 }}
    >
      {track && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imgRef}
          src={neteaseDirectCover(track.cover)}
          alt=""
          // 网易 CDN 防盗链：带 referer 会 403 → 背景大图空白黑屏。去掉 referer 修复。
          // （TrackCover 早有此处理，背景层之前漏了，才有"小封面正常、大背景黑"。）
          referrerPolicy="no-referrer"
          className={`absolute inset-0 h-full w-full object-cover ${kbClass}`}
          style={{
            // Lite tier: drop the 20px blur entirely. We compensate visually with
            // a heavier dim overlay below + a slight scale so the unblurred cover
            // doesn't read as the foreground.
            filter: lite ? "saturate(1.15) brightness(0.55)" : "blur(20px) saturate(1.15)",
            willChange: lite ? "opacity" : "opacity, transform",
            transform: lite ? "scale(1.1)" : undefined,
            opacity: 1, // updated per-frame by the rAF loop above
          }}
          draggable={false}
        />
      )}
    </div>
  )
}
