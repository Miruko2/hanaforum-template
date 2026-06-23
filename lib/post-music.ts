// 音乐分享卡：由帖子里的歌曲信息（posts.music）拼出一首「临时曲目」交给全站播放器。
// 卡片(components/music-post-body) 与 详情页(components/music-detail-player) 共用，避免重复。
import type { Post } from "./types"
import type { Track } from "@/app/music/_data/tracks"

// id 用帖子 id 派生：稳定、唯一、不与用户自己曲库里的歌撞（故 play 时走「外部临时曲目」分支）。
export function postMusicTrackId(postId: string): string {
  return `forum-music-${postId}`
}

export function postMusicToTrack(post: Post): Track | null {
  const m = post.music
  if (!m) return null
  return {
    id: postMusicTrackId(post.id),
    title: m.title || "未知歌曲",
    artist: m.artist || "未知歌手",
    cover: m.cover || "",
    audio: m.audio || "",
    hue: 0,
    ratio: 1,
    span: 1,
    userProvided: true, // 外链封面：原生 <img> + 跳过服务端取色
    local: false,
  }
}

// 在线/精选歌且有音源才可在线播放；本地歌(playable=false)只展示。
export function isMusicPlayable(post: Post): boolean {
  return !!post.music?.playable && !!post.music?.audio
}
