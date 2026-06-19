// lib/mengmegzi/image-sources.ts
//
// 图源适配层：按分类配置 + AI 关键词拉一张外部图。
// AI 只生成文字 + 一个英文配图关键词(image_query)；选哪个源、拉哪张全由代码决定。
// 返回 null = 不配图或拉图失败，调用方降级纯文字帖。
//
// 两类源：
//   · danbooru —— 二次元动漫图（契合站点）。AI 关键词转 tag 搜 + rating:g（最严）+ order:score
//     （只取高赞精品）+ tag 黑名单二次过滤；用 large_file_url（sample ~850px）当主图、直传不另压。
//   · unsplash —— 真实照片（保留兼容）。imgix 参数返回压好的 webp 主图 + 缩略图。
//
// 返回的 ImageResult 带 query/viaFallback/score 等可观测字段，executor 写进行动日志，
// 方便在 admin 面板看到「AI 词命中 / 回退默认 tag」与图的质量分。

import { BOORU_TAG_BLOCKLIST, IMAGE_MAX_EDGE, IMAGE_QUALITY } from "./constants"
import { POST_THUMB_EDGE } from "@/lib/post-image-thumb"

export interface ImageSourceConfig {
  provider: "none" | "unsplash" | "danbooru"
  /** unsplash: 回退搜索词 / danbooru: 回退 tag（AI 关键词搜不到时用） */
  query?: string
}

export interface ImageResult {
  /** 主图可直接下载 URL（已是目标尺寸/格式） */
  imageUrl: string
  /** 缩略图可下载 URL（webp）；没有则 null，卡片回退主图 */
  thumbUrl?: string | null
  ext: string // "webp" | "jpg" | "png"
  contentType: string // image/webp | image/jpeg | image/png
  width: number
  height: number
  source: string
  /** 实际命中的搜索词/tag（写进行动日志，便于观察 AI 词命中情况） */
  query?: string
  /** 是否用了分类回退 tag（true = AI 的 image_query 没命中、退回默认 tag） */
  viaFallback?: boolean
  /** danbooru 图的 score（点赞分，质量参考） */
  score?: number
}

/**
 * 按分类配置 + AI 关键词拉一张图。
 * - none → null
 * - danbooru/unsplash → 先用 AI 关键词，搜不到回退 config.query（标 viaFallback）
 * - 任何失败 → null（调用方降级纯文字帖）
 */
export async function fetchImageForCategory(
  config: ImageSourceConfig | null | undefined,
  aiQuery?: string | null,
): Promise<ImageResult | null> {
  if (!config || config.provider === "none") return null
  const ai = (aiQuery || "").trim()

  if (config.provider === "danbooru") {
    const aiTag = toBooruTag(ai)
    if (aiTag) {
      const r = await fetchFromDanbooru(aiTag)
      if (r) return { ...r, viaFallback: false }
    }
    const fb = await fetchFromDanbooru(toBooruTag(config.query || ""))
    return fb ? { ...fb, viaFallback: true } : null
  }

  if (config.provider === "unsplash") {
    if (ai) {
      const r = await fetchFromUnsplash(ai)
      if (r) return { ...r, viaFallback: false }
    }
    const fb = await fetchFromUnsplash(config.query || "")
    return fb ? { ...fb, viaFallback: true } : null
  }

  return null
}

// ── danbooru（二次元动漫图，主用） ──

const DANBOORU_TIMEOUT = 8000

/** AI 自然语言关键词 → booru 友好的单 tag（小写、空格→下划线、去杂质、限长） */
function toBooruTag(s: string): string {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40)
}

/** post 是否命中 nsfw 黑名单（tag_string 含任一黑名单词，整词匹配） */
function hitsBlocklist(tagString: string): boolean {
  const tags = new Set((tagString || "").toLowerCase().split(/\s+/))
  return BOORU_TAG_BLOCKLIST.some((bad) => tags.has(bad))
}

function guessExt(u: string): string {
  const m = /\.(webp|png|jpe?g)(?:\?|$)/i.exec(u)
  if (!m) return "jpg"
  const e = m[1].toLowerCase()
  return e === "jpeg" ? "jpg" : e
}

function extToContentType(ext: string): string {
  if (ext === "webp") return "image/webp"
  if (ext === "png") return "image/png"
  return "image/jpeg"
}

/**
 * 调 Danbooru：tags = `<tag> rating:g order:score`（匿名限 2 个普通 tag；rating:/order: 是
 * metatag、不占限制，故只用了 1 个普通 tag）。order:score 只取高赞精品（默认顺序全是 0 赞冷门图）。
 * 取 top 50 → 过滤(rating g、有 sample URL、不命中黑名单) → 随机选一张干净的。
 * 失败/无干净结果返回 null。
 */
async function fetchFromDanbooru(tag: string): Promise<ImageResult | null> {
  const t = (tag || "").trim()
  if (!t) return null
  const url = new URL("https://danbooru.donmai.us/posts.json")
  // rating:g 排除 sensitive/questionable/explicit；order:score 只取高赞精品
  //（默认顺序全是 0 赞冷门图 → 难看的多）。rating:/order: 是 metatag、不占匿名 2 个普通
  // tag 限制，所以 `<tag> rating:g order:score` 只用了 1 个普通 tag、可行。
  url.searchParams.set("tags", `${t} rating:g order:score`)
  url.searchParams.set("limit", "50") // top 50 高赞里随机选：质量高 + 保留多样性
  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "HanakosForumBot/1.0 (mengmegzi agent)", // Danbooru 要求带标识 UA
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(DANBOORU_TIMEOUT),
    })
    if (!res.ok) {
      console.warn("[mengmegzi] danbooru 失败:", res.status)
      return null
    }
    const posts = (await res.json()) as Array<{
      large_file_url?: string
      file_url?: string
      image_width?: number
      image_height?: number
      rating?: string
      tag_string?: string
      score?: number
    }>
    if (!Array.isArray(posts) || posts.length === 0) return null
    // 三重防线：必须 rating g、有可下载 sample URL、tag 不命中黑名单
    const clean = posts.filter(
      (p) =>
        p.rating === "g" &&
        Boolean(p.large_file_url || p.file_url) &&
        !hitsBlocklist(p.tag_string || ""),
    )
    if (clean.length === 0) return null
    const pick = clean[Math.floor(Math.random() * clean.length)]
    const imageUrl = (pick.large_file_url || pick.file_url)! // 850px sample 优先
    const ext = guessExt(imageUrl)
    return {
      imageUrl,
      thumbUrl: null, // 850px sample 直接当主图，不另出缩略图
      ext,
      contentType: extToContentType(ext),
      width: pick.image_width || 0,
      height: pick.image_height || 0,
      source: "danbooru",
      query: t,
      score: typeof pick.score === "number" ? pick.score : undefined,
    }
  } catch (e: any) {
    console.warn("[mengmegzi] danbooru 异常:", e?.message || e)
    return null
  }
}

// ── unsplash（真实照片，imgix；保留兼容） ──

const UNSPLASH_TIMEOUT = 8000

/** 给 Unsplash raw URL 拼 imgix 参数：放进 edge×edge 框、保持比例、转 webp、压质量。 */
function imgixUrl(rawUrl: string, edge: number, quality: number): string {
  const u = new URL(rawUrl)
  u.searchParams.set("w", String(edge))
  u.searchParams.set("h", String(edge))
  u.searchParams.set("fit", "max")
  u.searchParams.set("fm", "webp")
  u.searchParams.set("q", String(quality))
  u.searchParams.set("auto", "compress")
  return u.toString()
}

async function fetchFromUnsplash(query: string): Promise<ImageResult | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) {
    console.warn("[mengmegzi] UNSPLASH_ACCESS_KEY 未配置，跳过配图")
    return null
  }
  if (!query.trim()) return null
  const url = new URL("https://api.unsplash.com/search/photos")
  url.searchParams.set("query", query)
  url.searchParams.set("per_page", "10")
  url.searchParams.set("orientation", "squarish")
  url.searchParams.set("content_filter", "high") // 过滤不适内容（萌萌子帖更安全）
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Client-ID ${key}` },
      signal: AbortSignal.timeout(UNSPLASH_TIMEOUT),
    })
    if (!res.ok) {
      console.warn("[mengmegzi] unsplash 失败:", res.status)
      return null
    }
    const data = (await res.json()) as {
      results?: { urls?: { raw?: string }; width?: number; height?: number }[]
    }
    const results = data.results || []
    if (results.length === 0) return null
    const pick = results[Math.floor(Math.random() * results.length)]
    const raw = pick?.urls?.raw
    if (!raw) return null
    return {
      imageUrl: imgixUrl(raw, IMAGE_MAX_EDGE, IMAGE_QUALITY),
      thumbUrl: imgixUrl(raw, POST_THUMB_EDGE, 80),
      ext: "webp",
      contentType: "image/webp",
      width: pick.width || 0,
      height: pick.height || 0,
      source: "unsplash",
      query,
    }
  } catch (e: any) {
    console.warn("[mengmegzi] unsplash 异常:", e?.message || e)
    return null
  }
}
