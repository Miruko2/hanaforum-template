// 公共 Meting 实例表（主备回退）。
// 背景：解析与播放原本单点依赖 injahow，它一挂（如 Redis 写盘失败时返回
// HTTP 200 + PHP Fatal error 文本）全站歌曲就不可用。这里维护若干接口格式
// 完全相同的公共实例，按顺序作为主力/备胎：
//   · 歌单/单曲解析（musicImport）：逐个实例试，谁返回合法 JSON 用谁；
//   · 播放（PlaybackContext）：存库的 audio_url 带着具体实例域名，<audio>
//     加载报错时把 URL 换到下一个实例重试，全试完才判"音源不可用"。
// 要求：实例必须 CORS 为 *、路径形如 https://host/path/?query（query 同构）。
export const METING_INSTANCES = [
  "https://api.injahow.cn/meting/",
  "https://api.qijieya.cn/meting/",
] as const

/** 规整成不带末尾斜杠的前缀，便于和 URL 的 ? 前部分比对 */
const normalize = (base: string) => base.replace(/\/+$/, "")

/**
 * 给定一条 meting URL，返回「同一查询参数在其它实例上的 URL」列表（按实例表顺序、
 * 排除当前实例）。不是已知实例的 URL（自定义直链等）返回空数组 = 无可回退。
 */
export function metingAlternatives(url: string): string[] {
  const q = url.indexOf("?")
  if (q < 0) return []
  const prefix = normalize(url.slice(0, q))
  const query = url.slice(q) // 含 "?"
  if (!METING_INSTANCES.some((b) => normalize(b) === prefix)) return []
  return METING_INSTANCES.filter((b) => normalize(b) !== prefix).map(
    (b) => normalize(b) + "/" + query,
  )
}
