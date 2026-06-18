// lib/mengmegzi/__tests__/image-sources.test.ts
//
// 图源适配层测试。mock global fetch，不真实调 Unsplash。

import { fetchImageForCategory, type ImageSourceConfig } from "../image-sources"

const fetchMock = jest.fn() as jest.Mock
global.fetch = fetchMock as any

describe("image-sources", () => {
  beforeEach(() => fetchMock.mockReset())

  test("provider=none 返回 null 且不调 fetch", async () => {
    const cfg: ImageSourceConfig = { provider: "none" }
    const r = await fetchImageForCategory("code", cfg)
    expect(r).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("provider=unsplash 返回 url，调用带 Authorization 头", async () => {
    process.env.UNSPLASH_ACCESS_KEY = "test-key"
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ urls: { regular: "https://images.unsplash.com/photo-1" } }],
      }),
    } as any)
    const cfg: ImageSourceConfig = { provider: "unsplash", query: "video game" }
    const r = await fetchImageForCategory("game", cfg)
    expect(r).not.toBeNull()
    expect(r!.url).toBe("https://images.unsplash.com/photo-1")
    expect(r!.source).toBe("unsplash")
    // 确认调了 unsplash API
    const calledUrl = new URL(fetchMock.mock.calls[0][0])
    expect(calledUrl.hostname).toBe("api.unsplash.com")
    expect(calledUrl.searchParams.get("query")).toBe("video game")
    // 确认带 key
    const headers = fetchMock.mock.calls[0][1]?.headers
    expect(headers?.Authorization).toBe("Client-ID test-key")
  })

  test("unsplash 返回空 results 返回 null", async () => {
    process.env.UNSPLASH_ACCESS_KEY = "test-key"
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as any)
    const cfg: ImageSourceConfig = { provider: "unsplash", query: "x" }
    const r = await fetchImageForCategory("life", cfg)
    expect(r).toBeNull()
  })

  test("unsplash HTTP 失败返回 null（调用方降级纯文字）", async () => {
    process.env.UNSPLASH_ACCESS_KEY = "test-key"
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as any)
    const cfg: ImageSourceConfig = { provider: "unsplash", query: "x" }
    const r = await fetchImageForCategory("life", cfg)
    expect(r).toBeNull()
  })

  test("UNSPLASH_ACCESS_KEY 未配置返回 null", async () => {
    delete process.env.UNSPLASH_ACCESS_KEY
    const cfg: ImageSourceConfig = { provider: "unsplash", query: "x" }
    const r = await fetchImageForCategory("life", cfg)
    expect(r).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("未知 provider 返回 null", async () => {
    const cfg: ImageSourceConfig = { provider: "foobar" as any }
    const r = await fetchImageForCategory("general", cfg)
    expect(r).toBeNull()
  })

  test("config 为 null/undefined 返回 null", async () => {
    const r1 = await fetchImageForCategory("general", null as any)
    const r2 = await fetchImageForCategory("general", undefined as any)
    expect(r1).toBeNull()
    expect(r2).toBeNull()
  })
})
