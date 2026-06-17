// 表情包（与聊天窗 floating-chat 同款资源）：在发帖正文与评论里以内联 token 复用。
//
// 设计：表情以纯文本标记 [s:happy] 形式嵌入现有 content/description 字段，
// 不新增任何数据库列——发帖/评论照常存纯文本；展示时再把标记解析回贴纸图片。
// 资源位于 public/hanako/stickers/<name>.<ext>，扩展名不定（jpg/png/webp/gif），按序探测。

import { normalizeEmotion } from "@/lib/hanako/constants"

// 与聊天窗展示的表情保持一致（floating-chat.tsx 的 STICKERS）。
// 注：public/hanako/stickers 下另有 angry.jpg，但聊天窗未启用，这里同样不收录以保持一致。
export const STICKERS = ["happy", "shy", "worried", "cuddle", "surprised", "sleepy"] as const

export type StickerName = (typeof STICKERS)[number]

// 依次尝试这些扩展名（与 floating-chat 的 HanakoImg 一致）
export const STICKER_ASSET_EXTS = ["jpg", "png", "webp", "gif"] as const

export const STICKER_BASE_PATH = "/hanako/stickers"

// 只有已知贴纸名才会被当作表情渲染；其余 [s:xxx] 文本一律原样保留
const STICKER_SET: ReadonlySet<string> = new Set(STICKERS)

// 文本里插入的贴纸标记
export function makeStickerToken(name: string): string {
  return `[s:${name}]`
}

// 匹配 [s:name]，name 仅限小写字母/数字/下划线/连字符
const STICKER_TOKEN_RE = /\[s:([a-z0-9_-]+)\]/gi

export type StickerSegment =
  | { type: "text"; value: string }
  | { type: "sticker"; name: StickerName }

// 把含 token 的文本切成「文本 / 贴纸」片段；未知贴纸名当普通文本保留
export function parseStickerText(text: string): StickerSegment[] {
  if (!text) return []
  const segments: StickerSegment[] = []
  const re = new RegExp(STICKER_TOKEN_RE.source, "gi")
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    // 归一旧别名（如历史数据里的 yandere→cuddle），再判定是否已知贴纸
    const name = normalizeEmotion(m[1].toLowerCase())
    if (!STICKER_SET.has(name)) continue // 未知贴纸：不切片，保留原文
    if (m.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, m.index) })
    }
    segments.push({ type: "sticker", name: name as StickerName })
    lastIndex = m.index + m[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) })
  }
  return segments
}

// 文本是否含已知贴纸标记（快速判断，避免无谓的解析/包裹）
export function hasStickerToken(text: string | null | undefined): boolean {
  if (!text) return false
  const re = new RegExp(STICKER_TOKEN_RE.source, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (STICKER_SET.has(normalizeEmotion(m[1].toLowerCase()))) return true
  }
  return false
}

// ── 扩展名解析（带整页缓存）──
// 同一名字整页只探测一次：首个组件触发 HEAD 探测，结果缓存，其余组件直取，
// 避免大量评论/正文里重复 HEAD 请求。
// 值：string = 已解析 URL；null = 四种扩展名都 404（放弃）。
const resolved = new Map<string, string | null>()
const inflight = new Map<string, Promise<string | null>>()

// 已缓存结果：string=成功 URL，null=已确认失败，undefined=尚未探测
export function getCachedStickerUrl(name: string): string | null | undefined {
  return resolved.get(name)
}

export async function resolveStickerUrl(name: string): Promise<string | null> {
  if (resolved.has(name)) return resolved.get(name) ?? null
  const pending = inflight.get(name)
  if (pending) return pending

  const probe = (async () => {
    for (const ext of STICKER_ASSET_EXTS) {
      const url = `${STICKER_BASE_PATH}/${name}.${ext}`
      try {
        // 用 HEAD 探测，避免 404 污染控制台（与 floating-chat 的 HanakoImg 一致）
        const res = await fetch(url, { method: "HEAD" })
        if (res.ok) {
          resolved.set(name, url)
          return url
        }
      } catch {
        // 网络错误：试下一个扩展名
      }
    }
    resolved.set(name, null)
    return null
  })()

  inflight.set(name, probe)
  try {
    return await probe
  } finally {
    inflight.delete(name)
  }
}
