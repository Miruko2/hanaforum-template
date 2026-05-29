"use client"

import { useEffect, useRef } from "react"
import { usePlayback } from "../_context/PlaybackContext"

/**
 * Looping MP4 backdrop. Replaces the per-track CoverBackdrop with a single
 * always-on ambient video. The video's opacity still pulses with the audio
 * intensity so it feels alive even though the visual itself is canned.
 *
 * Browsers require `muted` + `autoPlay` together for autoplay to work
 * without user gesture; `playsInline` keeps iOS from going fullscreen.
 */
export function VideoBackdrop() {
  const { getAudioIntensity } = usePlayback()
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // Per-frame opacity pulse via rAF + DOM write (bypasses React).
  useEffect(() => {
    let mounted = true
    let raf = 0
    const loop = () => {
      if (!mounted) return
      const intensity = getAudioIntensity() // 0..1, paused returns 1
      // Opacity range tuned for video: a bit higher floor than the cover
      // backdrop, since the video is the only "art" on screen.
      const pulse = 0.6 + intensity * 0.4
      if (videoRef.current) videoRef.current.style.opacity = String(pulse)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      mounted = false
      cancelAnimationFrame(raf)
    }
  }, [getAudioIntensity])

  // Kick the video into playing on mount. Browsers grant autoplay for muted
  // <video> tags but sometimes the very first play() needs a nudge after
  // hydration. We don't ever pause it after this — the loop is constant.
  useEffect(() => {
    const v = videoRef.current
    if (v) v.play().catch(() => {})
  }, [])

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <video
        ref={videoRef}
        src="/music_backgroud.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          willChange: "opacity",
          opacity: 0.6, // initial; rAF takes over
        }}
      />
      {/* Same bottom darken as CoverBackdrop, so the player chrome stays
          legible regardless of what the video is doing. */}
      <div
        className="absolute inset-x-0 bottom-0 h-2/5"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.75), transparent)",
        }}
      />
    </div>
  )
}
