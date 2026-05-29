"use client"

import { useEffect, useRef, useState } from "react"
import { usePlayback } from "../_context/PlaybackContext"
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
export function CoverBackdrop() {
  const { currentTrack, getAudioIntensity } = usePlayback()

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
    img.src = currentTrack.cover
    const flip = () => setActive(inactive)
    if (img.complete && img.naturalWidth > 0) flip()
    else {
      img.onload = flip
      img.onerror = flip
    }
  }, [currentTrack, active])

  // Audio-reactive pulse — driven entirely by rAF + refs, never re-renders.
  useEffect(() => {
    let mounted = true
    let raf = 0
    const loop = () => {
      if (!mounted) return
      const intensity = getAudioIntensity() // 0..1, paused returns 1 (steady)
      // Map intensity → opacity multiplier. At intensity 1: full base opacity.
      // At intensity 0: dimmed to ~0.55. Sweet spot for "breathing" effect.
      const pulse = 0.55 + intensity * 0.45
      if (imgRefA.current) imgRefA.current.style.opacity = String(pulse)
      if (imgRefB.current) imgRefB.current.style.opacity = String(pulse)
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
      <Layer track={layerA} visible={active === "a"} imgRef={imgRefA} kbClass="cover-kb-a" />
      <Layer track={layerB} visible={active === "b"} imgRef={imgRefB} kbClass="cover-kb-b" />
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
}: {
  track: Track | null
  visible: boolean
  imgRef: React.MutableRefObject<HTMLImageElement | null>
  kbClass: string
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
          src={track.cover}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover ${kbClass}`}
          style={{
            filter: "blur(20px) saturate(1.15)",
            willChange: "opacity, transform",
            opacity: 1, // updated per-frame by the rAF loop above
          }}
          draggable={false}
        />
      )}
    </div>
  )
}
