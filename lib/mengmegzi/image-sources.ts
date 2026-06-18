// lib/mengmegzi/image-sources.ts
//
// 图源适配层：按分类配置拉一张外部图。
// AI 不碰图——选哪个源、拉哪张图全由代码决定。
// 返回 null = 不配图或拉图失败，调用方降级纯文字帖。

export type CategoryValue = string

export interface ImageSourceConfig {
  provider: "none" | "unsplash"
  query?: string
}

export interface ImageResult {
  url: string
  source: string
}

/**
 * 按分类配置拉一张图。
 * - provider=none → 直接返回 null（纯文字帖）
 * - provider=unsplash → 调 Unsplash search API
 * - 任何失败 → 返回 null（调用方降级纯文字帖）
 */
export async function fetchImageForCategory(
  _category: CategoryValue,
  config: ImageSourceConfig | null | undefined,
): Promise<ImageResult | null> {
  if (!config || config.provider === "none") return null
  if (config.provider === "unsplash") return await fetchFromUnsplash(config.query || "")
  return null
}

/** 调 Unsplash search API 拉一张图。失败返回 null。 */
async function fetchFromUnsplash(query: string): Promise<ImageResult | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) {
    console.warn("[mengmegzi] UNSPLASH_ACCESS_KEY 未配置，跳过配图")
    return null
  }
  const url = new URL("https://api.unsplash.com/search/photos")
  url.searchParams.set("query", query)
  url.searchParams.set("per_page", "1")
  url.searchParams.set("orientation", "squarish")
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Client-ID ${key}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.warn("[mengmegzi] unsplash 失败:", res.status)
      return null
    }
    const data = (await res.json()) as { results?: { urls?: { regular?: string } }[] }
    const u = data.results?.[0]?.urls?.regular
    return u ? { url: u, source: "unsplash" } : null
  } catch (e: any) {
    console.warn("[mengmegzi] unsplash 异常:", e?.message || e)
    return null
  }
}
