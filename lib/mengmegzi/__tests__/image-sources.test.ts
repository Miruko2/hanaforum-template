// lib/mengmegzi/__tests__/image-sources.test.ts
//
// 图源适配层测试。mock global fetch，不真实调外部 API。
// 重点覆盖 danbooru 的 nsfw 过滤（rating:g + tag 黑名单）——这是站点红线。

import { fetchImageForCategory, type ImageSourceConfig } from "../image-sources"

const fetchMock = jest.fn() as jest.Mock
global.fetch = fetchMock as any

function unsplashResp(raw: string, width = 1000, height = 1000) {
  return { ok: true, json: async () => ({ results: [{ urls: { raw }, width, height }] }) } as any
}

function danbooruPost(over: Partial<Record<string, any>> = {}) {
  return {
    large_file_url: "https://cdn.donmai.us/sample/aa/bb/sample-x.jpg",
    file_url: "https://cdn.donmai.us/original/aa/bb/x.jpg",
    image_width: 850,
    image_height: 1200,
    rating: "g",
    tag_string: "1girl original solo",
    ...over,
  }
}
function danbooruResp(posts: any[]) {
  return { ok: true, json: async () => posts } as any
}

describe("image-sources", () => {
  beforeEach(() => fetchMock.mockReset())

  test("provider=none 返回 null 且不调 fetch", async () => {
    const r = await fetchImageForCategory({ provider: "none" })
    expect(r).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ── danbooru（主用，二次元动漫图） ──

  test("danbooru 返回 sample 主图 + jpg + 宽高；请求带 AI tag + rating:g", async () => {
    fetchMock.mockResolvedValueOnce(danbooruResp([danbooruPost()]))
    const cfg: ImageSourceConfig = { provider: "danbooru", query: "original" }
    const r = await fetchImageForCategory(cfg, "guitar")
    expect(r).not.toBeNull()
    expect(r!.source).toBe("danbooru")
    expect(r!.imageUrl).toContain("sample-x.jpg")
    expect(r!.ext).toBe("jpg")
    expect(r!.contentType).toBe("image/jpeg")
    expect(r!.thumbUrl).toBeNull()
    expect(r!.width).toBe(850)
    expect(r!.height).toBe(1200)
    const called = new URL(fetchMock.mock.calls[0][0])
    expect(called.hostname).toBe("danbooru.donmai.us")
    expect(called.searchParams.get("tags")).toBe("guitar rating:g order:score")
    // 带标识 UA
    expect(fetchMock.mock.calls[0][1]?.headers?.["User-Agent"]).toContain("HanakosForumBot")
  })

  test("danbooru: 过滤掉命中 nsfw 黑名单的 post（loli）", async () => {
    fetchMock.mockResolvedValueOnce(
      danbooruResp([
        danbooruPost({
          tag_string: "1girl loli original",
          large_file_url: "https://cdn.donmai.us/sample/bad.jpg",
        }),
        danbooruPost({
          tag_string: "1girl scenery",
          large_file_url: "https://cdn.donmai.us/sample/good.jpg",
        }),
      ]),
    )
    const r = await fetchImageForCategory({ provider: "danbooru", query: "original" }, "scenery")
    // 只可能选到干净那张
    expect(r!.imageUrl).toContain("good.jpg")
  })

  test("danbooru: 过滤掉 rating 非 g 的 post", async () => {
    fetchMock.mockResolvedValueOnce(
      danbooruResp([
        danbooruPost({ rating: "s", large_file_url: "https://cdn.donmai.us/sample/sensitive.jpg" }),
        danbooruPost({ rating: "g", large_file_url: "https://cdn.donmai.us/sample/general.jpg" }),
      ]),
    )
    const r = await fetchImageForCategory({ provider: "danbooru", query: "x" }, "y")
    expect(r!.imageUrl).toContain("general.jpg")
  })

  test("danbooru: AI 关键词转 booru tag（小写 + 下划线）", async () => {
    fetchMock.mockResolvedValueOnce(danbooruResp([danbooruPost()]))
    await fetchImageForCategory({ provider: "danbooru", query: "original" }, "Night City")
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("tags")).toBe(
      "night_city rating:g order:score",
    )
  })

  test("danbooru: AI tag 全被过滤 → 回退分类 tag → 仍空 → null", async () => {
    fetchMock
      .mockResolvedValueOnce(danbooruResp([danbooruPost({ tag_string: "loli" })])) // AI tag 命中黑名单滤空
      .mockResolvedValueOnce(danbooruResp([])) // 回退 tag 也空
    const r = await fetchImageForCategory({ provider: "danbooru", query: "original" }, "badword")
    expect(r).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("danbooru: HTTP 失败返回 null", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as any)
    const r = await fetchImageForCategory({ provider: "danbooru", query: "x" }, "y")
    expect(r).toBeNull()
  })

  // ── unsplash（保留兼容，真实照片） ──

  test("unsplash 返回 imgix webp 主图 + 640 缩略图 + 宽高", async () => {
    process.env.UNSPLASH_ACCESS_KEY = "test-key"
    fetchMock.mockResolvedValueOnce(unsplashResp("https://images.unsplash.com/photo-1", 1200, 800))
    const r = await fetchImageForCategory({ provider: "unsplash", query: "video game" })
    expect(r!.source).toBe("unsplash")
    expect(r!.ext).toBe("webp")
    expect(r!.contentType).toBe("image/webp")
    expect(r!.width).toBe(1200)
    expect(r!.height).toBe(800)
    const main = new URL(r!.imageUrl)
    expect(main.hostname).toBe("images.unsplash.com")
    expect(main.searchParams.get("fm")).toBe("webp")
    expect(main.searchParams.get("w")).toBe("1920")
    expect(new URL(r!.thumbUrl!).searchParams.get("w")).toBe("640")
  })

  test("unsplash: AI 关键词优先，命中只调一次", async () => {
    process.env.UNSPLASH_ACCESS_KEY = "test-key"
    fetchMock.mockResolvedValueOnce(unsplashResp("https://images.unsplash.com/ai"))
    const r = await fetchImageForCategory({ provider: "unsplash", query: "video game" }, "coffee shop")
    expect(r!.imageUrl).toContain("images.unsplash.com/ai")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("query")).toBe("coffee shop")
  })

  test("unsplash: key 未配置返回 null", async () => {
    delete process.env.UNSPLASH_ACCESS_KEY
    const r = await fetchImageForCategory({ provider: "unsplash", query: "x" })
    expect(r).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ── 杂项 ──

  test("未知 provider 返回 null", async () => {
    const r = await fetchImageForCategory({ provider: "foobar" as any })
    expect(r).toBeNull()
  })

  test("config 为 null/undefined 返回 null", async () => {
    expect(await fetchImageForCategory(null as any)).toBeNull()
    expect(await fetchImageForCategory(undefined as any)).toBeNull()
  })
})
