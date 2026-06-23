"use client"

import React, { useMemo } from "react"
import { Music2 } from "lucide-react"
import { MusicPlayButton } from "@/components/music-play-button"
import { cdnUrl } from "@/lib/cdn-url"
import type { Post } from "@/lib/types"
import { usePlayback } from "@/app/music/_context/PlaybackContext"
import { postMusicToTrack, isMusicPlayable } from "@/lib/post-music"

/**
 * 论坛瀑布流里「音乐分享卡」的封面/播放区（替代普通帖子的图片区）。
 *
 * 只有 post.music 存在的帖子才渲染本组件 —— 因此只有音乐卡订阅全站播放器，
 * 播放/暂停时不会波及整条瀑布流（普通图文卡不订阅、零重渲染）。
 *   · 在线歌 / 精选歌（playable）：封面右下角播放键，点一下走 playExternal 就地播放，
 *     复用全站迷你播放器（不打开帖子详情，stopPropagation）；
 *   · 本地上传歌：只展示封面 + 「本地歌」标，无播放键。
 */
export function MusicPostBody({ post }: { post: Post }) {
  const m = post.music
  const { playExternal, togglePlay, currentTrack, isPlaying } = usePlayback()

  // 由帖子里的歌曲信息拼出一首「临时曲目」交给播放器（详情页共用同一拼装，见 lib/post-music）。
  const track = useMemo(() => postMusicToTrack(post), [post])

  if (!m || !track) return null

  const playable = isMusicPlayable(post)
  const isCurrent = currentTrack?.id === track.id
  const playing = isCurrent && isPlaying

  const onPlay = (e: React.MouseEvent) => {
    e.stopPropagation() // 不要冒泡到卡片（卡片点击是打开帖子详情）
    if (!playable) return
    if (isCurrent) togglePlay()
    else playExternal(track)
  }

  const coverSrc = m.cover ? cdnUrl(m.cover) : ""

  return (
    <div className="image-container group relative overflow-hidden">
      <div className="relative aspect-square w-full">
        {coverSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverSrc}
            alt={m.title || ""}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-zinc-700 to-zinc-900">
            <Music2 size={40} className="text-white/40" />
          </div>
        )}

        {/* 底部歌名/歌手条（渐变压底保证可读） */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-3 pb-3 pt-10">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white drop-shadow">{m.title}</div>
              <div className="truncate text-xs text-white/70">{m.artist}</div>
            </div>
            {playable ? (
              <MusicPlayButton
                playing={playing}
                size={44}
                onClick={onPlay}
                className="pointer-events-auto"
              />
            ) : (
              <span className="pointer-events-none shrink-0 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white/80">
                本地歌
              </span>
            )}
          </div>
        </div>

        {/* 左上角：正在播放=霓虹均衡器跳动；否则=音乐卡标识。去 backdrop-blur（瀑布流大量卡片，安卓鬼影高发） */}
        <span className="absolute left-2 top-2 flex h-6 items-center gap-1 rounded-full bg-black/55 px-2 text-white">
          {playing ? (
            <span className="flex h-3 items-end gap-[2px]" aria-label="正在播放">
              <span className="mpb-eq-bar bg-lime-300" style={{ animationDelay: "0ms" }} />
              <span className="mpb-eq-bar bg-lime-300" style={{ animationDelay: "160ms" }} />
              <span className="mpb-eq-bar bg-lime-300" style={{ animationDelay: "320ms" }} />
            </span>
          ) : (
            <Music2 size={13} />
          )}
        </span>
      </div>
    </div>
  )
}

export default MusicPostBody
