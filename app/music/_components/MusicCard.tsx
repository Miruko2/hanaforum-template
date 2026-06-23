"use client"

import { forwardRef, memo, useRef } from "react"
import { Play, Heart, SkipBack, SkipForward } from "lucide-react"
import { MusicPlayButton } from "@/components/music-play-button"
import type { Track } from "../_data/tracks"
import type { ExpandRect } from "./ExpandedCard"
import { usePlaybackWall } from "../_context/PlaybackContext"
import { TrackCover } from "./TrackCover"

type Props = {
  track: Track
  width: number
  height: number
  onExpand: (track: Track, rect: ExpandRect) => void
  /** Lite tier (phone / reduced-motion): drop the inset gloss highlight. */
  lite?: boolean
  /** Android: smaller drop shadow (cheaper to over-draw while the wall drags). */
  android?: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Single music card — frosted glass: the card is (almost) COLOURLESS and
 * translucent with a hairline rim, and a real `backdrop-filter` frosts the clear
 * backdrop behind it. (Works only because the canvas no longer writes a fisheye
 * `filter` on cards — an element's own filter voids its backdrop-filter; see
 * MusicCanvas.) Content is the slimmed-down player: artwork + title/artist + one
 * transport row (prev / play / next / favourite) — no progress or volume bar.
 *
 * prev / play / next / favourite are live; full controls live in the expanded
 * card + bottom player. pointer-events-auto re-enables hit-testing; per-frame 3D
 * transforms are written by the canvas via the ref, not React state, so this
 * only re-renders on track / playing / favourite change.
 */
function MusicCardBase(
  { track, width, height, onExpand, lite = false, android = false }: Props,
  ref: React.ForwardedRef<HTMLDivElement>,
) {
  const { currentTrack, isPlaying: globalPlaying, togglePlay, prev, next, isFavorite, toggleFavorite } = usePlaybackWall()
  const isCurrent = currentTrack?.id === track.id
  const isPlaying = isCurrent && globalPlaying
  const fav = isFavorite(track.id)
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null)

  // 卡片宽度驱动的等比尺寸：瀑布流卡片宽度 ~126(手机) ~165(桌面单) ~345(桌面双)。
  const pad = clamp(Math.round(width * 0.055), 8, 14)
  const coverRadius = clamp(pad + 2, 9, 14)
  const titleSize = clamp(Math.round(width * 0.092), 12, 16)
  const artistSize = clamp(Math.round(width * 0.072), 10, 13)
  const playSize = clamp(Math.round(width * 0.2), 30, 44)
  const playIcon = Math.round(playSize * 0.44)
  const sideIcon = clamp(Math.round(width * 0.092), 14, 19)

  // 玻璃底色 + backdrop-filter 由 CSS 类提供（不写 inline）：桌面用 .mw-glass 满磨砂
  // blur(18)，手机/降低动效层(lite)用 .mw-glass-lite 全程浅模糊 blur(6)（用户要手机端
  // 统一用「移动时那个模糊」；仍是实时采样毛玻璃、只省模糊核，详见 globals.css）。
  // 边框恒为中性白细线 —— 正在播放也不染色（用户要求），保持原样；当前曲改由中间
  // 圆形主键变白底来指示，不靠边框。
  const rim = "0 0 0 1px rgba(255,255,255,0.45)"
  const gloss = lite ? "" : ", inset 0 1px 0 rgba(255,255,255,0.28)"
  const boxShadow = android
    ? `0 8px 22px -10px rgba(0,0,0,0.5), ${rim}${gloss}`
    : `0 18px 44px -16px rgba(0,0,0,0.55), ${rim}${gloss}`
  const textShadow = "0 1px 3px rgba(0,0,0,0.7)"
  const ctrlShadow = "drop-shadow(0 1px 2px rgba(0,0,0,0.6))"

  return (
    <div
      ref={ref}
      data-card
      data-far="0"
      onPointerDown={(e) => {
        downRef.current = { x: e.clientX, y: e.clientY, t: performance.now() }
      }}
      onClick={(e) => {
        const d = downRef.current
        downRef.current = null
        if (!d) return
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || performance.now() - d.t > 500) return
        if (!isPlaying) togglePlay(track.id)
        onExpand(track, (e.currentTarget as HTMLDivElement).getBoundingClientRect())
      }}
      className={`${lite ? "mw-glass-lite" : "mw-glass"} absolute top-0 left-0 flex flex-col cursor-pointer overflow-hidden pointer-events-auto opacity-0 will-change-transform`}
      style={{
        width,
        height,
        transform: "translate3d(0,0,0)",
        borderRadius: 20,
        boxShadow,
      }}
    >
      <div className="relative flex min-h-0 flex-1 flex-col" style={{ padding: pad, gap: pad - 2 }}>
        {/* Crisp artwork tile */}
        <div
          className="relative min-h-0 flex-1 overflow-hidden"
          style={{ borderRadius: coverRadius, boxShadow: "0 6px 16px -6px rgba(0,0,0,0.5)" }}
        >
          <TrackCover track={track} sizes="240px" />
        </div>

        {/* Title / artist */}
        <div className="text-center">
          <div
            className="truncate font-semibold leading-tight text-white"
            style={{ fontSize: titleSize, textShadow }}
          >
            {track.title}
          </div>
          <div
            className="truncate leading-tight text-white/75"
            style={{ fontSize: artistSize, marginTop: 1, textShadow }}
          >
            {track.artist}
          </div>
        </div>

        {/* Transport — prev / play / next / favourite */}
        <div className="flex items-center justify-between text-white/85">
          <button
            type="button"
            className="shrink-0 transition-colors hover:text-white"
            style={{ filter: ctrlShadow }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (isCurrent) prev()
            }}
            aria-label="prev"
          >
            <SkipBack size={sideIcon} />
          </button>
          {isCurrent ? (
            // 选中（正在放）那颗：换成全站统一的毛玻璃描边圆钮，封面主色描边＝在放指示
            <MusicPlayButton
              playing={isPlaying}
              size={playSize}
              hue={track.hue}
              onClick={(e) => {
                e.stopPropagation()
                togglePlay(track.id)
              }}
              onPointerDown={(e) => e.stopPropagation()}
            />
          ) : (
            // 闲置态保持原样（用户认可）：半透白圆 + 白三角，不动
            <button
              type="button"
              className="grid shrink-0 place-items-center rounded-full bg-white/20 text-white transition-transform hover:bg-white/30 active:scale-95"
              style={{ width: playSize, height: playSize, filter: lite ? undefined : ctrlShadow }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                togglePlay(track.id)
              }}
              aria-label="play"
            >
              <Play size={playIcon} className="translate-x-[1px]" />
            </button>
          )}
          <button
            type="button"
            className="shrink-0 transition-colors hover:text-white"
            style={{ filter: ctrlShadow }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (isCurrent) next()
            }}
            aria-label="next"
          >
            <SkipForward size={sideIcon} />
          </button>
          <button
            type="button"
            className={`shrink-0 transition-colors ${fav ? "text-rose-400" : "hover:text-white"}`}
            style={{ filter: ctrlShadow }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleFavorite(track.id)
            }}
            aria-label={fav ? "unlike" : "like"}
          >
            <Heart size={sideIcon} fill={fav ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
    </div>
  )
}

export const MusicCard = memo(forwardRef<HTMLDivElement, Props>(MusicCardBase))
MusicCard.displayName = "MusicCard"
