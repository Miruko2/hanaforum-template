import type { UserMusicTrackInput } from "@/lib/supabase"
import { neteaseDirectCover } from "./neteasePic"

// 第三方 Meting 实例（公共）。歌单/单曲解析全在客户端发起：
// 浏览器直连 injahow（其 CORS 为 *），请求分散在各用户 IP，我们服务器不参与
// （无 SSRF、不汇聚流量）。返回的 url 是 injahow 的 type=url 重解析跳转，
// 每次播放现取新签名、不会过期。
const METING_BASE = "https://api.injahow.cn/meting/"

export type NeteaseRef = { type: "playlist" | "song"; id: string }

/**
 * 从用户粘贴的内容解析出 {类型, id}。
 *   · 仅接受完整 music.163.com 链接（含 #/ 形式），或纯数字 id（当歌单）。
 *   · 不收 163cn.tv 短链 —— 短链要服务端跟跳转 = SSRF 面，故要求贴完整链接。
 */
export function parseNeteaseUrl(input: string): NeteaseRef | null {
  const s = input.trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return { type: "playlist", id: s }

  let type: "playlist" | "song" | null = null
  if (/playlist/i.test(s)) type = "playlist"
  else if (/song/i.test(s)) type = "song"

  const m = s.match(/[?&]id=(\d+)/) || s.match(/\/(?:playlist|song)\/(\d+)/)
  if (!type || !m) return null
  return { type, id: m[1] }
}

const clip = (s: unknown, n: number) =>
  typeof s === "string" ? s.trim().slice(0, n) : ""

/**
 * 调 injahow 取歌单/单曲，映射成可批量插入的输入。
 * 过滤掉没有有效 https 音频的条目；不在此处截断数量（由调用方按剩余配额截断）。
 */
export async function fetchNeteaseTracks(ref: NeteaseRef): Promise<UserMusicTrackInput[]> {
  const url = `${METING_BASE}?server=netease&type=${ref.type}&id=${encodeURIComponent(ref.id)}`
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new Error("网络错误：无法连接解析服务")
  }
  if (!res.ok) throw new Error(`解析失败（HTTP ${res.status}）`)

  let data: unknown
  try {
    data = await res.json()
  } catch {
    throw new Error("解析服务返回了无法识别的内容")
  }
  if (!Array.isArray(data) || data.length === 0) throw new Error("歌单为空或无法解析")

  const out: UserMusicTrackInput[] = []
  for (const item of data as Array<Record<string, unknown>>) {
    const audio = typeof item?.url === "string" ? item.url : ""
    if (!/^https:\/\//i.test(audio)) continue
    // injahow 的 pic 跳转换成网易 CDN 直链（稳、并发无压）。
    const picRaw = typeof item?.pic === "string" ? item.pic : ""
    const pic = /^https:\/\//i.test(picRaw) ? neteaseDirectCover(picRaw) : ""
    out.push({
      title: clip(item?.name, 200) || "未命名",
      artist: clip(item?.artist, 200),
      cover_url: pic.slice(0, 2048),
      audio_url: audio.slice(0, 2048),
      source: "netease",
    })
  }
  if (out.length === 0) throw new Error("没有可用的曲目（可能均为 VIP / 区域受限）")
  return out
}
