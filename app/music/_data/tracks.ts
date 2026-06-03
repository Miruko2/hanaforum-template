// Playlist data is baked at build time from NetEase Cloud Music playlist 2705159244.
// To refresh, run: pnpm tsx scripts/refresh-playlist.ts
import playlistJson from "./playlist.json"

export type Track = {
  id: string
  title: string
  artist: string
  cover: string          // NetEase CDN URL (p1/p2/p3/p4.music.126.net), permanent
  audio: string          // Meting proxy URL — redirects to a signed NetEase audio URL
  hue: number
  ratio: number          // height / width
  span: 1 | 2            // grid units wide
  /**
   * 用户自定义曲目（来自 user_music_tracks，封面是任意外链）。
   * 置 true 时渲染层走原生 <img>（绕开 next/image 白名单）、并跳过基于
   * img-proxy 的服务端取色（避免 fetch 任意 URL，SSRF 安全）。
   */
  userProvided?: boolean
}

export const TRACKS: Track[] = playlistJson as Track[]

// 精选默认墙（编译期烘焙的网易歌单）。用户未自定义 / 游客时回退到它。
export const DEFAULT_TRACKS: Track[] = TRACKS
