"use client"

import React, { useMemo, useRef } from "react"
import { Play, Pause, Music2 } from "lucide-react"
import { cdnUrl } from "@/lib/cdn-url"
import type { Post } from "@/lib/types"
import { usePlayback, usePlaybackTime } from "@/app/music/_context/PlaybackContext"
import { useDominantHue } from "@/app/music/_lib/useDominantHue"
import { postMusicToTrack, isMusicPlayable } from "@/lib/post-music"

const SOURCE_LABEL: Record<string, string> = {
  featured: "精选",
  netease: "网易云音乐",
  qq: "QQ 音乐",
  link: "外部链接",
  local: "本地上传",
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00"
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, "0")}`
}

/**
 * 帖子详情页里的「音乐播放块」。复用全站播放器（playExternal 播一首不在曲库里的临时歌）。
 *   · 在线 / 精选歌：大封面 + 播放/暂停 + 可点按进度条，封面主色调驱动辉光/进度色；
 *   · 本地上传歌：仅展示封面/信息 + 「无法在线播放」说明。
 */
export function MusicDetailPlayer({ post }: { post: Post }) {
  const m = post.music
  const { playExternal, togglePlay, seek, currentTrack, isPlaying } = usePlayback()
  const { currentTime, duration } = usePlaybackTime()
  const barRef = useRef<HTMLDivElement | null>(null)

  const coverSrc = m?.cover ? cdnUrl(m.cover) : ""
  // 封面主色调（取不到时回退柔和绿）；与音乐区一致用 hue 点缀。
  const extracted = useDominantHue(coverSrc || null)
  const hue = extracted ?? 150

  const track = useMemo(() => postMusicToTrack(post), [post])
  if (!m || !track) return null

  const playable = isMusicPlayable(post)
  const isCurrent = currentTrack?.id === track.id
  const playing = isCurrent && isPlaying
  const pct = isCurrent && duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
  const accent = `hsl(${hue} 72% 62%)`

  const onPlay = () => {
    if (!playable) return
    if (isCurrent) togglePlay()
    else playExternal(track)
  }

  const onBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isCurrent || !duration) return
    const el = barRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width < 1) return
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    seek(ratio * duration)
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-5 p-6">
      {/* 封面主色调氛围辉光（纯渐变，安卓安全） */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(58% 42% at 50% 36%, hsl(${hue} 70% 46% / 0.22), transparent 70%)` }}
      />

      {/* 大封面 */}
      <div
        className="relative aspect-square w-full max-w-[260px] overflow-hidden rounded-2xl ring-1 ring-white/10"
        style={{ boxShadow: `0 24px 64px -16px hsl(${hue} 70% 40% / 0.55)` }}
      >
        {coverSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverSrc} alt={m.title || ""} className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-zinc-700 to-zinc-900">
            <Music2 size={56} className="text-white/40" />
          </div>
        )}
        {playable && (
          <button
            type="button"
            aria-label={playing ? "暂停" : "播放"}
            onClick={onPlay}
            className="absolute inset-0 grid place-items-center bg-black/0 transition-colors hover:bg-black/25"
          >
            <span
              className="grid place-items-center text-white transition-transform hover:scale-110 active:scale-95"
              style={{ filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.5))" }}
            >
              {playing ? (
                <Pause size={42} fill="currentColor" />
              ) : (
                <Play size={44} fill="currentColor" className="translate-x-[2px]" />
              )}
            </span>
          </button>
        )}
      </div>

      {/* 歌名 / 歌手 / 来源（正在播放时歌名旁跳均衡器） */}
      <div className="relative w-full max-w-[300px] text-center">
        <div className="flex items-center justify-center gap-2">
          {playing && (
            <span className="flex h-3.5 items-end gap-[2px]" aria-label="正在播放">
              <span className="mpb-eq-bar" style={{ background: accent, animationDelay: "0ms" }} />
              <span className="mpb-eq-bar" style={{ background: accent, animationDelay: "160ms" }} />
              <span className="mpb-eq-bar" style={{ background: accent, animationDelay: "320ms" }} />
            </span>
          )}
          <div className="truncate text-base font-semibold text-white">{m.title}</div>
        </div>
        <div className="mt-0.5 truncate text-sm text-white/60">{m.artist}</div>
        <div className="mt-1 text-[11px] text-white/40">
          {m.source && SOURCE_LABEL[m.source] ? SOURCE_LABEL[m.source] : "歌曲"}
        </div>
      </div>

      {/* 进度条（仅可播歌）；本地歌给出说明 */}
      {playable ? (
        <div className="relative w-full max-w-[300px]">
          <div
            ref={barRef}
            className="relative h-1.5 cursor-pointer rounded-full bg-white/15"
            onClick={onBarClick}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${pct}%`,
                background: `linear-gradient(90deg, hsl(${hue} 75% 60%), hsl(${(hue + 30) % 360} 80% 66%))`,
              }}
            />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
              style={{ left: `${pct}%` }}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-white/40">
            <span>{fmt(isCurrent ? currentTime : 0)}</span>
            <span>{fmt(isCurrent ? duration : 0)}</span>
          </div>
        </div>
      ) : (
        <div className="relative max-w-[300px] rounded-lg bg-white/[0.04] px-3 py-2 text-center text-xs text-white/45">
          上传者的本地歌，仅展示，无法在线播放
        </div>
      )}
    </div>
  )
}

export default MusicDetailPlayer
