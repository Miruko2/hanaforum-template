// lib/mengmegzi/__tests__/image-sources.test.ts
//
// 图源适配层测试。mock global fetch（按 URL 分流，因 danbooru 分支现为 danbooru+yande.re 多源并行）。
// 重点覆盖：多源聚合/容错、nsfw 过滤（danbooru rating:g + yande.re rating:s+性感黑名单）、tag 降级。

import { fetchImageForCategory, type ImageSourceConfig } from "../image-sources"

const fetchMock = jest.fn() as jest.Mock
global.fetch = fetchMock as any

function danbooruPost(over: Record<string, any> = {}) {
  return {
    large_file_url: "https://cdn.donmai.us/sample/aa/sample-x.jpg",
    file_url: "https://cdn.donmai.us/original/aa/x.jpg",
    image_width: 850,
    image_height: 1200,
    rating: "g",
    tag_string: "1girl original solo",
    score: 300,
    ...over,
  }
}
function yanderePost(over: Record<string, any> = {}) {
  return {
    sample_url: "https://files.yande.re/sample/bb/sample-y.jpg",
    file_url: "https://files.yande.re/image/bb/y.jpg",
    sample_width: 1500,
    sample_height: 1000,
    width: 3000,
    height: 2000,
    rating: "s",
    tags: "scenery sky cloud",
    score: 120,
    ...over,
  }
}
function unsplashRaw(raw: string, w = 1000, h = 1000) {
  return { urls: { raw }, width: w, height: h }
}

/** 按 URL 分流 mock：danbooru / yande.re / unsplash 各自返回配置的结果 */
function mockSources(o: {
  danbooru?: any[]
  yandere?: any[]
  unsplash?: any[]
  danbooruStatus?: number
  yandereStatus?: number
} = {}) {
  fetchMock.mockImplementation((u: any) => {
    const url = String(u)
    if (url.includes("danbooru.donmai.us")) {
      if (o.danbooruStatus && o.danbooruStatus !== 200)
        return Promise.resolve({ ok: false, status: o.danbooruStatus })
      return Promise.resolve({ ok: true, json: async () => o.danbooru ?? [] })
    }
    if (url.includes("yande.re")) {
      if (o.yandereStatus && o.yandereStatus !== 200)
        return Promise.resolve({ ok: false, status: o.yandereStatus })
      return Promise.resolve({ ok: true, json: async () => o.yandere ?? [] })
    }
    if (url.includes("api.unsplash.com")) {
      return Promise.resolve({ ok: true, json: async () => ({ results: o.unsplash ?? [] }) })
    }
    return Promise.resolve({ ok: false, status: 404 })
  })
}

describe("image-sources", () => {
  beforeEach(() => fetchMock.mockReset())

  test("provider=none 返回 null 且不调 fetch", async () => {
    const r = await fetchImageForCategory({ provider: "none" })
    expect(r).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ── 多源（danbooru + yande.re） ──

  test("多源: danbooru 命中(yande.re 空) → 返回 danbooru，带 query/score/viaFallback", async () => {
    mockSources({ danbooru: [danbooruPost()], yandere: [] })
    const r = await fetchImageForCategory({ provider: "danbooru", query: "original" }, "guitar")
    expect(r!.source).toBe("danbooru")
    expect(r!.query).toBe("guitar")
    expect(r!.viaFallback).toBe(false)
    expect(typeof r!.score).toBe("number")
    // danbooru 请求带 rating:g order:score + UA
    const dbCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("danbooru"))!
    expect(new URL(dbCall[0]).searchParams.get("tags")).toBe("guitar rating:g order:score")
    expect(dbCall[1]?.headers?.["User-Agent"]).toContain("HanakosForumBot")
  })

  test("多源容错: danbooru 空 + yande.re 命中 → 返回 yande.re", async () => {
    mockSources({ danbooru: [], yandere: [yanderePost()] })
    const r = await fetchImageForCategory({ provider: "danbooru", query: "scenery" }, "sky")
    expect(r!.source).toBe("yandere")
    expect(r!.imageUrl).toContain("yande.re")
    expect(r!.ext).toBe("jpg")
    expect(r!.width).toBe(1500)
  })

  test("多源容错: danbooru 报错(500)也不影响 yande.re", async () => {
    mockSources({ danbooruStatus: 500, yandere: [yanderePost()] })
    const r = await fetchImageForCategory({ provider: "danbooru", query: "scenery" }, "sky")
    expect(r!.source).toBe("yandere")
  })

  test("danbooru: 过滤 nsfw 黑名单(loli)", async () => {
    mockSources({
      danbooru: [
        danbooruPost({ tag_string: "1girl loli", large_file_url: "https://cdn.donmai.us/sample/bad.jpg" }),
        danbooruPost({ tag_string: "1girl scenery", large_file_url: "https://cdn.donmai.us/sample/good.jpg" }),
      ],
      yandere: [],
    })
    const r = await fetchImageForCategory({ provider: "danbooru", query: "original" }, "scenery")
    expect(r!.imageUrl).toContain("good.jpg")
  })

  test("danbooru: 过滤 rating 非 g", async () => {
    mockSources({
      danbooru: [
        danbooruPost({ rating: "s", large_file_url: "https://cdn.donmai.us/sample/sens.jpg" }),
        danbooruPost({ rating: "g", large_file_url: "https://cdn.donmai.us/sample/gen.jpg" }),
      ],
      yandere: [],
    })
    const r = await fetchImageForCategory({ provider: "danbooru", query: "x" }, "y")
    expect(r!.imageUrl).toContain("gen.jpg")
  })

  test("danbooru: 排除动图/视频(file_ext=mp4)，只留静态图", async () => {
    mockSources({
      danbooru: [
        danbooruPost({ file_ext: "mp4", large_file_url: "https://cdn.donmai.us/sample/vid.jpg" }),
        danbooruPost({ file_ext: "jpg", large_file_url: "https://cdn.donmai.us/sample/img.jpg" }),
      ],
      yandere: [],
    })
    const r = await fetchImageForCategory({ provider: "danbooru", query: "x" }, "y")
    expect(r!.imageUrl).toContain("img.jpg")
  })

  test("yande.re: 过滤性感 tag(swimsuit) 与 rating 非 s", async () => {
    mockSources({
      danbooru: [],
      yandere: [
        yanderePost({ tags: "1girl swimsuit", sample_url: "https://files.yande.re/sample/sw.jpg" }),
        yanderePost({ tags: "scenery", sample_url: "https://files.yande.re/sample/sc.jpg" }),
      ],
    })
    const r = await fetchImageForCategory({ provider: "danbooru", query: "scenery" }, "y")
    expect(r!.imageUrl).toContain("sc.jpg")
  })

  test("tag 降级: pink_game_controller → controller(多源)", async () => {
    // 只有 controller 级 danbooru 命中，其余都空
    fetchMock.mockImplementation((u: any) => {
      const url = String(u)
      const tag = new URL(url).searchParams.get("tags") || ""
      if (url.includes("danbooru") && tag.startsWith("controller "))
        return Promise.resolve({ ok: true, json: async () => [danbooruPost()] })
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    const r = await fetchImageForCategory(
      { provider: "danbooru", query: "video_game" },
      "pink game controller",
    )
    expect(r!.source).toBe("danbooru")
    expect(r!.query).toBe("controller")
    expect(r!.viaFallback).toBe(false)
  })

  test("全空 → 回退分类 tag → 仍空 → null", async () => {
    mockSources({ danbooru: [], yandere: [] })
    const r = await fetchImageForCategory({ provider: "danbooru", query: "original" }, "badword")
    expect(r).toBeNull()
  })

  // ── suggestive（色图·软色情不露点：danbooru s + yande.re q） ──

  test("suggestive: danbooru 用 rating:s、yande.re 用 rating:q（双源）", async () => {
    mockSources({
      danbooru: [danbooruPost({ rating: "s" })],
      yandere: [yanderePost({ rating: "q" })],
    })
    const r = await fetchImageForCategory({ provider: "suggestive", query: "swimsuit" }, "thighhighs")
    expect(r).not.toBeNull()
    expect(["danbooru", "yandere"]).toContain(r!.source)
    expect(["s", "q"]).toContain(r!.rating)
    const dbCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("danbooru.donmai.us"))!
    expect(new URL(dbCall[0]).searchParams.get("tags")).toBe("thighhighs rating:s order:score")
    const yCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("yande.re"))!
    expect(new URL(yCall[0]).searchParams.get("tags")).toBe("thighhighs rating:q order:score")
  })

  test("suggestive: 放行 swimsuit/bikini（性感不露点，安全路径反而会拦）", async () => {
    mockSources({
      danbooru: [],
      yandere: [yanderePost({ rating: "q", tags: "1girl swimsuit", sample_url: "https://files.yande.re/sample/sw.jpg" })],
    })
    const r = await fetchImageForCategory({ provider: "suggestive", query: "swimsuit" }, "ocean")
    expect(r!.source).toBe("yandere")
    expect(r!.imageUrl).toContain("sw.jpg")
  })

  test("suggestive: 仍拦露点 nipples，只留不露点", async () => {
    mockSources({
      danbooru: [],
      yandere: [
        yanderePost({ rating: "q", tags: "1girl nipples", sample_url: "https://files.yande.re/sample/nsfw.jpg" }),
        yanderePost({ rating: "q", tags: "1girl bikini", sample_url: "https://files.yande.re/sample/ok.jpg" }),
      ],
    })
    const r = await fetchImageForCategory({ provider: "suggestive", query: "swimsuit" }, "beach")
    expect(r!.imageUrl).toContain("ok.jpg")
  })

  test("suggestive: 词边界拦复合露点 tag（group_sex / cum_on_body）", async () => {
    mockSources({
      danbooru: [],
      yandere: [
        yanderePost({ rating: "q", tags: "1girl group_sex", sample_url: "https://files.yande.re/sample/a.jpg" }),
        yanderePost({ rating: "q", tags: "2girls cum_on_body", sample_url: "https://files.yande.re/sample/b.jpg" }),
        yanderePost({ rating: "q", tags: "1girl lingerie", sample_url: "https://files.yande.re/sample/c.jpg" }),
      ],
    })
    const r = await fetchImageForCategory({ provider: "suggestive", query: "swimsuit" }, "x")
    expect(r!.imageUrl).toContain("c.jpg")
  })

  test("suggestive: loli 红线仍拦（色图分类也绝不破）", async () => {
    mockSources({
      danbooru: [],
      yandere: [
        yanderePost({ rating: "q", tags: "1girl loli swimsuit", sample_url: "https://files.yande.re/sample/loli.jpg" }),
      ],
    })
    const r = await fetchImageForCategory({ provider: "suggestive", query: "swimsuit" }, "x")
    expect(r).toBeNull()
  })

  test("suggestive: 容错——yande.re 挂(500) 仍走 danbooru s", async () => {
    mockSources({ danbooru: [danbooruPost({ rating: "s" })], yandereStatus: 500 })
    const r = await fetchImageForCategory({ provider: "suggestive", query: "swimsuit" }, "thighhighs")
    expect(r!.source).toBe("danbooru")
    expect(r!.rating).toBe("s")
  })

  test("suggestive: AI 词空 → 回退默认 swimsuit", async () => {
    mockSources({ danbooru: [], yandere: [yanderePost({ rating: "q" })] })
    const r = await fetchImageForCategory({ provider: "suggestive" }, "")
    expect(r!.viaFallback).toBe(true)
    const yCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("yande.re"))!
    expect(new URL(yCall[0]).searchParams.get("tags")).toBe("swimsuit rating:q order:score")
  })

  // ── unsplash（保留兼容） ──

  test("unsplash: imgix webp 主图 + 640 缩略图", async () => {
    process.env.UNSPLASH_ACCESS_KEY = "test-key"
    mockSources({ unsplash: [unsplashRaw("https://images.unsplash.com/p1", 1200, 800)] })
    const r = await fetchImageForCategory({ provider: "unsplash", query: "x" })
    expect(r!.source).toBe("unsplash")
    expect(r!.ext).toBe("webp")
    expect(new URL(r!.imageUrl).searchParams.get("fm")).toBe("webp")
    expect(new URL(r!.thumbUrl!).searchParams.get("w")).toBe("640")
  })

  test("unsplash: key 未配置 → null", async () => {
    delete process.env.UNSPLASH_ACCESS_KEY
    mockSources({ unsplash: [unsplashRaw("x")] })
    const r = await fetchImageForCategory({ provider: "unsplash", query: "x" })
    expect(r).toBeNull()
  })

  test("config 为 null/undefined → null", async () => {
    expect(await fetchImageForCategory(null as any)).toBeNull()
    expect(await fetchImageForCategory(undefined as any)).toBeNull()
  })
})
