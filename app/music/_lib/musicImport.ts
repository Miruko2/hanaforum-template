import type { UserMusicTrackInput } from "@/lib/supabase"
import { neteaseDirectCover } from "./neteasePic"

// 第三方 Meting 实例（公共）。歌单/单曲解析全在客户端发起：
// 浏览器直连 injahow（其 CORS 为 *），请求分散在各用户 IP，我们服务器不参与
// （无 SSRF、不汇聚流量）。返回的 url 是 injahow 的 type=url 重解析跳转，
// 每次播放现取新签名、不会过期。
const METING_BASE = "https://api.injahow.cn/meting/"

// 支持的平台 = Meting 的 server 取值。
//   · netease = 网易云
//   · tencent = QQ音乐
// 只接这两家。酷狗/酷我（同腾讯系）分享出来是短链 + hash，要解析得服务端跟
// 跳转 = SSRF 面，与本设计（浏览器直连、零服务端解析）冲突，故不接。
export type MusicPlatform = "netease" | "tencent"
export type MetingRef = { type: "playlist" | "song"; id: string }
export type ParsedRef = { platform: MusicPlatform; ref: MetingRef }

const PLATFORM_LABEL: Record<MusicPlatform, string> = {
  netease: "网易云",
  tencent: "QQ音乐",
}
export function platformLabel(p: string): string {
  return (PLATFORM_LABEL as Record<string, string>)[p] ?? p
}

/**
 * 网易云：music.163.com，id 为纯数字。
 *   · 纯数字当歌单；含 playlist/song 关键字时按其判类型。
 *   · 不收 163cn.tv 短链 —— 短链要服务端跟跳转 = SSRF 面。
 */
function parseNetease(s: string): MetingRef | null {
  if (/^\d+$/.test(s)) return { type: "playlist", id: s }

  let type: "playlist" | "song" | null = null
  if (/playlist/i.test(s)) type = "playlist"
  else if (/song/i.test(s)) type = "song"

  const m = s.match(/[?&]id=(\d+)/) || s.match(/\/(?:playlist|song)\/(\d+)/)
  if (!type || !m) return null
  return { type, id: m[1] }
}

/**
 * QQ音乐：y.qq.com。歌单 disstid 为纯数字；单曲 songmid 为字母数字混合。
 * 只认完整 y.qq.com 链接 —— 里面直接带 id，无需跟短链跳转（不引入 SSRF）。
 *   · 单曲：/songDetail/{mid}、/song/{mid}.html
 *   · 歌单：/playlist/{disstid}、/playsquare/{disstid}、?id={disstid}（taoge）
 */
function parseTencent(s: string): MetingRef | null {
  if (!/y\.qq\.com/i.test(s)) return null

  // 单曲优先：songmid 是字母数字混合（与网易纯数字不同）
  let m = s.match(/\/song(?:Detail)?\/([0-9A-Za-z]+)/)
  if (m) return { type: "song", id: m[1] }

  // 歌单 disstid（纯数字）
  m =
    s.match(/\/playlist\/(\d+)/) ||
    s.match(/\/playsquare\/(\d+)/) ||
    s.match(/[?&]id=(\d+)/)
  if (m) return { type: "playlist", id: m[1] }

  return null
}

/**
 * 从用户粘贴内容自动识别平台并解析出 {平台, 类型, id}。
 *   · y.qq.com            → QQ音乐
 *   · music.163.com / 纯数字 → 网易云
 *   · 均要求完整链接（短链需服务端跟跳 = SSRF，本设计拒绝）。
 */
export function parseMusicUrl(input: string): ParsedRef | null {
  const s = input.trim()
  if (!s) return null

  if (/y\.qq\.com/i.test(s)) {
    const ref = parseTencent(s)
    return ref ? { platform: "tencent", ref } : null
  }
  if (/music\.163\.com/i.test(s) || /^\d+$/.test(s)) {
    const ref = parseNetease(s)
    return ref ? { platform: "netease", ref } : null
  }
  return null
}

const clip = (s: unknown, n: number) =>
  typeof s === "string" ? s.trim().slice(0, n) : ""

/**
 * QQ 封面直链：injahow 的 type=pic 是跳转，墙上十几张并发时易被限流 / 失败。
 * 从跳转 URL 取出 mid，拼成腾讯自家 CDN 直链（y.gtimg.cn，无防盗链、https、
 * 可缓存），并把 injahow 默认的 90x90 放大到 300x300（墙上才清晰）。
 * 与网易 neteaseDirectCover 同思路：绕开 injahow、并发无压、不经我们服务器。
 */
function tencentDirectCover(url: string): string {
  const m = url.match(/[?&]id=([0-9A-Za-z]+)/)
  if (m) return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${m[1]}.jpg`
  return url
}

/**
 * 调 injahow 取歌单/单曲，映射成可批量插入的输入。
 * 过滤掉没有有效 https 音频的条目；不在此处截断数量（由调用方按剩余配额截断）。
 *
 * 封面：两端都把 injahow 的 pic 跳转换成各自平台的 CDN 直链（并发稳、绕开
 * injahow 限流）——网易走 neteaseDirectCover，QQ 走 tencentDirectCover。
 */
export async function fetchMetingTracks(
  platform: MusicPlatform,
  ref: MetingRef,
): Promise<UserMusicTrackInput[]> {
  const url = `${METING_BASE}?server=${platform}&type=${ref.type}&id=${encodeURIComponent(ref.id)}`
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
    const picRaw = typeof item?.pic === "string" ? item.pic : ""
    const picHttps = /^https:\/\//i.test(picRaw) ? picRaw : ""
    const pic = platform === "netease" ? neteaseDirectCover(picHttps) : tencentDirectCover(picHttps)
    out.push({
      title: clip(item?.name, 200) || "未命名",
      artist: clip(item?.artist, 200),
      cover_url: pic.slice(0, 2048),
      audio_url: audio.slice(0, 2048),
      source: platform,
    })
  }
  if (out.length === 0) throw new Error("没有可用的曲目（可能均为 VIP / 区域受限）")
  return out
}
