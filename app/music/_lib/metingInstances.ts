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

/** 把已知 meting URL 改写到指定实例域名；非 meting URL（自定义直链）原样返回。 */
export function rewriteMetingBase(url: string, base: string): string {
  const q = url.indexOf("?")
  if (q < 0) return url
  const prefix = normalize(url.slice(0, q))
  if (!METING_INSTANCES.some((b) => normalize(b) === prefix)) return url
  return normalize(base) + "/" + url.slice(q)
}

// ---- 实例健康探测（会话内一次）----
// 背景：实例「挂」的典型表现不是 4xx/5xx，而是返回 HTTP 200 + text/html 空体
// （injahow Redis 故障时即如此），<audio> 指过去只会触发 error 事件。健康实例
// 的 type=url 会 302 跳到 CDN 媒体（或直接回 audio/* 内容）。
//
// 为什么必须探测：播放侧原本靠 <audio> 的 error 事件再换实例重试，但 iOS Safari
// 只允许「用户手势同步触发」的 play()；error 处理器里换 src 再 play() 不在手势栈中，
// 会被 iOS 拒绝 —— 于是主实例一挂，iPad 就彻底播不了（桌面/安卓允许非手势 play
// 故能自愈，掩盖了问题）。在用户点击前先探出健康实例、把 src 改写过去，手势内的
// 首次 play() 就直接命中可用实例，无需依赖 iOS 不支持的非手势回退。
const PROBE_ID = "1472822139" // 任意一个常驻网易曲目 id，仅用于探活
let healthyBasePromise: Promise<string> | null = null

async function isBaseHealthy(base: string): Promise<boolean> {
  try {
    const res = await fetch(normalize(base) + "/?server=netease&type=url&id=" + PROBE_ID, {
      // 健康实例会 302 到媒体；跟随后 content-type 为 audio/*。
      // 不读 body，拿到响应头即取消，避免下载整段音频。
      redirect: "follow",
    })
    if (!res.ok) {
      res.body?.cancel?.()
      return false
    }
    const ct = (res.headers.get("content-type") || "").toLowerCase()
    res.body?.cancel?.()
    return ct.startsWith("audio") || ct.startsWith("application/octet-stream")
  } catch {
    return false
  }
}

/**
 * 返回当前可用的 meting 实例域名（按 METING_INSTANCES 顺序取第一个探测通过的）。
 * 全挂时回退到列表首位（让播放侧的 error 回退继续兜底）。会话内只探测一次并缓存。
 */
export function pickHealthyMetingBase(): Promise<string> {
  if (!healthyBasePromise) {
    healthyBasePromise = (async () => {
      for (const base of METING_INSTANCES) {
        if (await isBaseHealthy(base)) return base
      }
      return METING_INSTANCES[0]
    })()
  }
  return healthyBasePromise
}
