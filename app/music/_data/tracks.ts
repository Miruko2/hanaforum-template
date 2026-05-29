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
}

export const TRACKS: Track[] = playlistJson as Track[]
