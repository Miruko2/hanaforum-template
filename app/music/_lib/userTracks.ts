import type { Track } from "../_data/tracks"
import type { UserMusicTrackRow } from "@/lib/supabase"

// 确定性哈希（FNV-1a 32-bit）：同一 id 永远得到同一 hue/ratio/span，
// 布局稳定、不需要抓封面、零服务端请求（SSRF 安全）。
function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * DB 行 → 3D 墙用的 Track。
 *   · hue/ratio/span 由 id 哈希确定性生成（布局稳定、跨刷新一致）。
 *   · 标 userProvided：让渲染层走原生 <img> 并跳过 img-proxy 取色。
 */
export function userRowToTrack(row: UserMusicTrackRow): Track {
  const h = hash32(row.id)
  const hue = h % 360
  // ratio（高/宽）落在 0.85..1.35 的悦目区间
  const ratio = 0.85 + ((h >>> 8) % 51) / 100
  // span：约 1/7 概率为宽卡(2)，其余为 1，制造与精选墙类似的错落
  const span: 1 | 2 = (h >>> 16) % 7 === 0 ? 2 : 1
  return {
    id: row.id,
    title: row.title || "未命名",
    artist: row.artist || "",
    cover: row.cover_url || "",
    audio: row.audio_url,
    hue,
    ratio,
    span,
    userProvided: true,
  }
}

export function userRowsToTracks(rows: UserMusicTrackRow[]): Track[] {
  return rows.map(userRowToTrack)
}
