"use client"

import { forwardRef, memo, useRef } from "react"
import { Pause, Play, Heart, MoreHorizontal, SkipBack, SkipForward } from "lucide-react"
import Image from "next/image"
import type { Track } from "../_data/tracks"
import type { ExpandRect } from "./ExpandedCard"
import { usePlayback } from "../_context/PlaybackContext"

type Props = {
  track: Track
  width: number
  height: number
  onExpand: (track: Track, rect: ExpandRect) => void
}

/**
 * Single music card. The container is a fixed-size box; the visual chrome
 * (image, glass overlay, controls) fills it. Per-frame fisheye transforms
 * are written by the parent canvas via the forwarded ref, NOT through React
 * state, so this component only re-renders when track/playing changes.
 *
 * pointer-events-auto re-enables hit-testing on the card itself; the Stage
 * wrapper sets pointer-events:none so its flat z=0 plane doesn't intercept
 * hits meant for the (z<0) cards behind it in the preserve-3d space.
 */
function MusicCardBase(
  { track, width, height, onExpand }: Props,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const { currentTrack, isPlaying: globalPlaying, togglePlay, prev, next, isFavorite, toggleFavorite } = usePlayback()
  const isCurrent = currentTrack?.id === track.id
  const isPlaying = isCurrent && globalPlaying
  const fav = isFavorite(track.id)
  // Track pointerdown info so click can decide: tap (expand) vs drag (swallow).
  // We DON'T stopPropagation on pointerdown so the canvas can start a pan from
  // anywhere on the card; we then ignore the click if the pointer travelled.
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null)
  return (
    <div
      ref={ref}
      data-card
      onPointerDown={(e) => {
        downRef.current = { x: e.clientX, y: e.clientY, t: performance.now() }
      }}
      onClick={(e) => {
        const d = downRef.current
        downRef.current = null
        if (!d) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        const dt = performance.now() - d.t
        // Only treat as a tap if it was small AND quick — otherwise it's a drag
        // and the click is collateral; swallow it.
        if (Math.hypot(dx, dy) > 5 || dt > 500) return
        onExpand(track, (e.currentTarget as HTMLDivElement).getBoundingClientRect())
      }}
      className="absolute top-0 left-0 cursor-pointer will-change-transform pointer-events-auto"
      style={{
        width,
        height,
        // Initial transform — replaced every frame by the canvas rAF loop.
        transform: "translate3d(0,0,0)",
        // Card hue tint backdrop; the cover image sits on top. Fully opaque
        // so the cover-backdrop layer behind doesn't bleed through corners.
        background: `linear-gradient(160deg, hsl(${track.hue} 70% 18%), hsl(${
          (track.hue + 40) % 360
        } 65% 10%))`,
        borderRadius: 18,
        boxShadow:
          "0 20px 60px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
        overflow: "hidden",
      }}
    >
      {/* Cover image fills the entire card */}
      <div className="absolute inset-0">
        <Image
          src={track.cover}
          alt={track.title}
          fill
          sizes="240px"
          className="object-cover"
          priority={false}
        />
        {/* Bottom fade so text underneath is readable */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/90 to-transparent" />
      </div>

      {/* Bottom info + controls */}
      <div className="absolute inset-x-0 bottom-0 p-3 backdrop-blur-md bg-black/65">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-white truncate">
              {track.title}
            </div>
            <div className="text-[11px] text-white/60 truncate">
              {track.artist}
            </div>
          </div>
          <button
            type="button"
            className="text-white/50 hover:text-white shrink-0"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
            }}
            aria-label="more"
          >
            <MoreHorizontal size={16} />
          </button>
        </div>

        {/* Transport row */}
        <div className="mt-2.5 flex items-center justify-between text-white/80">
          <button
            type="button"
            className="hover:text-white"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (isCurrent) prev()
            }}
            aria-label="prev"
          >
            <SkipBack size={14} />
          </button>
          <button
            type="button"
            className={`grid place-items-center h-7 w-7 rounded-full ${
              isCurrent ? "bg-white text-black" : "bg-white/15 hover:bg-white/25"
            }`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              togglePlay(track.id)
            }}
            aria-label={isPlaying ? "pause" : "play"}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} className="translate-x-[1px]" />}
          </button>
          <button
            type="button"
            className="hover:text-white"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (isCurrent) next()
            }}
            aria-label="next"
          >
            <SkipForward size={14} />
          </button>
          <button
            type="button"
            className={fav ? "text-rose-400" : "hover:text-white"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleFavorite(track.id)
            }}
            aria-label={fav ? "unlike" : "like"}
          >
            <Heart size={14} fill={fav ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
    </div>
  )
}

export const MusicCard = memo(forwardRef<HTMLDivElement, Props>(MusicCardBase))
MusicCard.displayName = "MusicCard"
