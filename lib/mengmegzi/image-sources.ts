// lib/mengmegzi/image-sources.ts
//
// 图源适配层：按分类配置 + AI 关键词拉一张外部图。
// AI 只生成文字 + 一个英文配图关键词(image_query)；选哪个源、拉哪张全由代码决定。
// 返回 null = 不配图或拉图失败，调用方降级纯文字帖。
//
// 三种 provider：
//   · danbooru   —— 安全二次元图。danbooru rating:g + yande.re rating:s 双源聚合，order:score
//     取高赞精品 + tag 黑名单二次过滤。用于 general/game/life。
//   · suggestive —— 色图(nsfw)「软色情·不露点」。danbooru rating:s（sensitive=性感不露点）+
//     yande.re rating:q（更辣）双源，放行 swimsuit/lingerie 等性感 tag，但用 SUGGESTIVE_EXTRA_BLOCK
//     拦掉一切露点/性行为 tag。loli/shota/guro 等红线词在 BOORU_TAG_BLOCKLIST，任何分类都拦。
//   · unsplash   —— 真实照片（保留兼容）。imgix 参数返回压好的 webp 主图 + 缩略图。
//
// 返回的 ImageResult 带 query/viaFallback/score/rating 等可观测字段，executor 写进行动日志，
// 方便在 admin 面板看到「AI 词命中 / 回退默认 tag」「质量分」「rating 级别」（色图分类便于人工抽查）。

import {
  BOORU_TAG_BLOCKLIST,
  SUGGESTIVE_EXTRA_BLOCK,
  IMAGE_MAX_EDGE,
  IMAGE_QUALITY,
} from "./constants"
import { POST_THUMB_EDGE } from "@/lib/post-image-thumb"

export interface ImageSourceConfig {
  provider: "none" | "unsplash" | "danbooru" | "suggestive"
  /** unsplash: 回退搜索词 / danbooru·suggestive: 回退 tag（AI 关键词搜不到时用） */
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
  /** booru 图的 score（点赞分，质量参考） */
  score?: number
  /** 实际 rating 级别（g/s/q）；色图分类便于人工抽查「是不是越了不露点线」 */
  rating?: string
}

/**
 * 按分类配置 + AI 关键词拉一张图。
 * - none → null
 * - danbooru/suggestive/unsplash → 先用 AI 关键词，搜不到回退 config.query（标 viaFallback）
 * - 任何失败 → null（调用方降级纯文字帖）
 */
export async function fetchImageForCategory(
  config: ImageSourceConfig | null | undefined,
  aiQuery?: string | null,
): Promise<ImageResult | null> {
  if (!config || config.provider === "none") return null
  const ai = (aiQuery || "").trim()

  if (config.provider === "danbooru") {
    // provider 仍叫 danbooru（DB 配置兼容），安全分类只走 danbooru rating:g（yande.re 只给色图）
    return runBooruPipeline(fetchFromSafeBooruSources, ai, config.query || "")
  }

  if (config.provider === "suggestive") {
    // 色图：danbooru(s) + yande.re(q) 软色情双源；回退 tag 缺省 swimsuit（必出性感不露点图）
    return runBooruPipeline(fetchFromSuggestiveBooruSources, ai, config.query || "swimsuit")
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

/**
 * booru 通用拉图流程：AI 词 → tag 逐级降级搜，命中即用；都没命中再回退分类 tag。
 * sourcesFn 决定走「安全双源」还是「软色情双源」。
 */
async function runBooruPipeline(
  sourcesFn: (tag: string) => Promise<ImageResult | null>,
  ai: string,
  fallbackQuery: string,
): Promise<ImageResult | null> {
  const aiTag = toBooruTag(ai)
  if (aiTag) {
    // tag 逐级降级：复合词搜不到就去前缀修饰词重试，命中即用（减少回退到泛分类 tag）
    for (const cand of tagDescentCandidates(aiTag)) {
      const r = await sourcesFn(cand)
      if (r) return { ...r, viaFallback: false }
    }
  }
  const fb = await sourcesFn(toBooruTag(fallbackQuery))
  return fb ? { ...fb, viaFallback: true } : null
}

// ── tag 处理 + 黑名单匹配 ──

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

/**
 * 复合 booru tag 逐级降级候选：去前缀修饰词、保留核心名词，让 AI 出的过具体词
 * (pink_game_controller) 也有机会命中真实 tag(controller)、不至一步退回泛分类 tag。
 * 最多 3 个（控请求数）：pink_game_controller → [pink_game_controller, game_controller, controller]
 */
function tagDescentCandidates(tag: string): string[] {
  const parts = tag.split("_").filter(Boolean)
  if (parts.length <= 1) return [tag]
  const cands = [tag]
  if (parts.length >= 3) cands.push(parts.slice(-2).join("_"))
  cands.push(parts[parts.length - 1])
  return [...new Set(cands)]
}

/**
 * tag_string 是否命中黑名单：整词 **或下划线词边界** 匹配。
 * booru 的露点/性行为常是复合 tag（cum_on_body / group_sex / anal_sex），纯整词匹配会漏，
 * 故边界匹配：bad 命中 `bad` 本身、`bad_*`、`*_bad`、`*_bad_*`，但不误伤 "cumulus"/"sexy"。
 */
function tagHitsAny(tagString: string, blocklist: readonly string[]): boolean {
  const tags = (tagString || "").toLowerCase().split(/\s+/).filter(Boolean)
  return tags.some((tag) =>
    blocklist.some(
      (bad) =>
        tag === bad ||
        tag.startsWith(bad + "_") ||
        tag.endsWith("_" + bad) ||
        tag.includes("_" + bad + "_"),
    ),
  )
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

// danbooru/yande.re 也托管动图/视频（mp4/webm/ugoira-zip）。这些 URL 常无图片后缀，会被
// guessExt 误判成 jpg、存成几十 MB 的「假图」（论坛上是破图 + 烧巨量 egress）。按 file_ext 排除。
const NON_IMAGE_EXTS = new Set(["mp4", "webm", "zip", "swf", "ugoira"])
function isAllowedMediaExt(ext?: string): boolean {
  return !ext || !NON_IMAGE_EXTS.has(ext.toLowerCase())
}

// ── danbooru（二次元动漫图） ──

const DANBOORU_TIMEOUT = 8000

interface BooruFetchOpts {
  /** danbooru: "g"(安全)|"s"(性感不露点)；决定 rating metatag + rating 过滤 */
  rating: string
  /** 在 BOORU_TAG_BLOCKLIST 之外额外屏蔽的 tag（词边界匹配） */
  extraBlock?: readonly string[]
}

/**
 * 调 Danbooru：tags = `<tag> rating:<r> order:score`（匿名限 2 个普通 tag；rating:/order: 是
 * metatag、不占限制，故只用了 1 个普通 tag）。order:score 只取高赞精品（默认顺序全是 0 赞冷门图）。
 * rating g=安全 / s=sensitive(性感不露点)。取 top 50 → 过滤(rating 匹配、有 URL、不命中黑名单)
 * → 高分前 12 随机选。失败/无干净结果返回 null。
 */
async function fetchFromDanbooru(tag: string, opts: BooruFetchOpts): Promise<ImageResult | null> {
  const t = (tag || "").trim()
  if (!t) return null
  const block = [...BOORU_TAG_BLOCKLIST, ...(opts.extraBlock || [])]
  const url = new URL("https://danbooru.donmai.us/posts.json")
  url.searchParams.set("tags", `${t} rating:${opts.rating} order:score`)
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
      file_ext?: string
    }>
    if (!Array.isArray(posts) || posts.length === 0) return null
    // 四重防线：rating 必须等于请求级别、是静态图(排除 mp4/webm/ugoira)、有可下载 URL、tag 干净
    const clean = posts.filter(
      (p) =>
        p.rating === opts.rating &&
        isAllowedMediaExt(p.file_ext) &&
        Boolean(p.large_file_url || p.file_url) &&
        !tagHitsAny(p.tag_string || "", block),
    )
    if (clean.length === 0) return null
    // order:score 已按分降序；只从高分前 12 张里随机选，避免随机到 top50 尾部的低分图
    const pool = clean.slice(0, 12)
    const pick = pool[Math.floor(Math.random() * pool.length)]
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
      rating: opts.rating,
    }
  } catch (e: any) {
    console.warn("[mengmegzi] danbooru 异常:", e?.message || e)
    return null
  }
}

// ── yande.re（壁纸级高画质动漫图；多源之一） ──

const YANDERE_TIMEOUT = 8000

// 安全分类（general/game/life）用 yande.re rating:s（safe）。曾额外屏蔽泳装/比基尼等性感向 tag
// 把这几个分类压更干净，但用户 2026-06-19 决定放开——普通分类也允许泳装/比基尼（仍 rating g/s、
// 偏清纯不露骨）。红线（loli/shota/露点）仍由 BOORU_TAG_BLOCKLIST 在 fetchFromYandere 内兜底、任何分类都拦。

/**
 * 调 yande.re（moebooru）：tags = `<tag> rating:<r> order:score`。
 * yande.re 只有 s/q/e。s=safe、q=questionable(软色情/可能含露点，靠黑名单兜不露点)。
 * 取 top12 高分随机一张。
 */
async function fetchFromYandere(tag: string, opts: BooruFetchOpts): Promise<ImageResult | null> {
  const t = (tag || "").trim()
  if (!t) return null
  const block = [...BOORU_TAG_BLOCKLIST, ...(opts.extraBlock || [])]
  const url = new URL("https://yande.re/post.json")
  url.searchParams.set("tags", `${t} rating:${opts.rating} order:score`)
  url.searchParams.set("limit", "50")
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "HanakosForumBot/1.0 (mengmegzi agent)", Accept: "application/json" },
      signal: AbortSignal.timeout(YANDERE_TIMEOUT),
    })
    if (!res.ok) {
      console.warn("[mengmegzi] yandere 失败:", res.status)
      return null
    }
    const posts = (await res.json()) as Array<{
      sample_url?: string
      jpeg_url?: string
      file_url?: string
      sample_width?: number
      sample_height?: number
      width?: number
      height?: number
      rating?: string
      tags?: string
      score?: number
      file_ext?: string
    }>
    if (!Array.isArray(posts) || posts.length === 0) return null
    const clean = posts.filter(
      (p) =>
        p.rating === opts.rating &&
        isAllowedMediaExt(p.file_ext) &&
        Boolean(p.sample_url || p.jpeg_url || p.file_url) &&
        !tagHitsAny(p.tags || "", block),
    )
    if (clean.length === 0) return null
    const pool = clean.slice(0, 12)
    const pick = pool[Math.floor(Math.random() * pool.length)]
    const imageUrl = (pick.sample_url || pick.jpeg_url || pick.file_url)! // sample(~1500px)优先
    const ext = guessExt(imageUrl)
    return {
      imageUrl,
      thumbUrl: null,
      ext,
      contentType: extToContentType(ext),
      width: pick.sample_width || pick.width || 0,
      height: pick.sample_height || pick.height || 0,
      source: "yandere",
      query: t,
      score: typeof pick.score === "number" ? pick.score : undefined,
      rating: opts.rating,
    }
  } catch (e: any) {
    console.warn("[mengmegzi] yandere 异常:", e?.message || e)
    return null
  }
}

/**
 * booru 双源聚合（仅色图用）：**yande.re 优先、danbooru 兜底**。两源并行发（不增延迟）；yande.re
 * 命中就用它（画质更高 ~1500px 精选板），只有 yande.re 没命中该 tag 或在 Vercel 挂了，才回退 danbooru
 * （色图永不会因 yande.re 抽风没图）。安全分类不走这里——只走 danbooru（见 fetchFromSafeBooruSources）。
 */
async function fetchFromBooruSources(
  tag: string,
  danbooruOpts: BooruFetchOpts,
  yandereOpts: BooruFetchOpts,
): Promise<ImageResult | null> {
  const t = (tag || "").trim()
  if (!t) return null
  const [danbooru, yandere] = await Promise.all([
    fetchFromDanbooru(t, danbooruOpts).catch(() => null),
    fetchFromYandere(t, yandereOpts).catch(() => null),
  ])
  return yandere || danbooru || null
}

/** 安全分类（general/game/life）：只走 danbooru rating:g。yande.re 只留给色图用。 */
function fetchFromSafeBooruSources(tag: string): Promise<ImageResult | null> {
  return fetchFromDanbooru(tag, { rating: "g" })
}

/**
 * 色图（nsfw）软色情：yande.re rating:q（更辣）优先、danbooru rating:s（性感不露点·安全网）兜底。
 * 两源都套 SUGGESTIVE_EXTRA_BLOCK（拦露点/性行为）+ BOORU_TAG_BLOCKLIST（loli/shota 等红线）。
 */
function fetchFromSuggestiveBooruSources(tag: string): Promise<ImageResult | null> {
  return fetchFromBooruSources(
    tag,
    { rating: "s", extraBlock: SUGGESTIVE_EXTRA_BLOCK },
    { rating: "q", extraBlock: SUGGESTIVE_EXTRA_BLOCK },
  )
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
