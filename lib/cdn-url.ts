// Supabase Storage 图片 URL → 自有 CDN（Cloudflare Worker 缓存层）重写。
//
// 背景：图片直连 Supabase 后 Cached Egress 爆配额（5GB/月，6天烧完）。
// Supabase 自家 CDN 的缓存命中也计入 egress，所以必须在它前面再挡一层：
//   用户 → img.自有域名（CF Worker，边缘缓存1年） → 未命中才回源 Supabase
// Worker 代码见 scripts/cloudflare-image-proxy-worker.js。
//
// 行为：
// - 未配置 NEXT_PUBLIC_IMG_CDN_BASE 时原样返回（部署 Worker 前后端可先上线，零风险）
// - 只重写本项目 Supabase 公开桶 URL，外链（网易封面等）原样返回
const CDN_BASE = (process.env.NEXT_PUBLIC_IMG_CDN_BASE || "").replace(/\/+$/, "")

const SUPABASE_STORAGE_PREFIX = (() => {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "")
  return base ? `${base}/storage/v1/object/public/` : null
})()

export function cdnUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (!CDN_BASE || !SUPABASE_STORAGE_PREFIX) return url
  if (!url.startsWith(SUPABASE_STORAGE_PREFIX)) return url
  return CDN_BASE + "/storage/v1/object/public/" + url.slice(SUPABASE_STORAGE_PREFIX.length)
}
