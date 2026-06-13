// Supabase Storage 图片 URL → 自有 CDN（Cloudflare Worker 缓存层）重写。
//
// 背景：图片直连 Supabase 后 Cached Egress 爆配额（5GB/月，6天烧完）。
// Supabase 自家 CDN 的缓存命中也计入 egress，所以必须在它前面再挡一层：
//   用户 → img.自有域名（CF Worker，边缘缓存1年） → 未命中才回源 Supabase
// Worker 代码见 scripts/cloudflare-image-proxy-worker.js。
//
// 行为：
// - 未配置 NEXT_PUBLIC_IMG_CDN_BASE 时原样返回（部署 Worker 前后端可先上线，零风险）
// - 只重写 Supabase 公开桶 URL，外链（网易封面等）原样返回
//
// ⚠️ 刻意不用 NEXT_PUBLIC_SUPABASE_URL 拼前缀做 startsWith 精确匹配：该环境变量值里
// 只要混进一个前导/尾随空格或换行，supabase-js 照常工作（fetch 的 URL 解析器会剥离
// 空白），但裸字符串 startsWith 会直接失配 → 全站图片悄悄不走 CDN、极难排查（2026-06
// 已踩过一次，根因正是 Vercel 该变量值有个前导空格）。这里改用「存储路径特征」判定，
// 与 SUPABASE_URL 的具体取值彻底解耦。
const CDN_BASE = (process.env.NEXT_PUBLIC_IMG_CDN_BASE || "").trim().replace(/\/+$/, "")

// Supabase 公开桶对象路径标志，命中即视为可走 CDN 缓存的存储对象
const STORAGE_MARKER = "/storage/v1/object/public/"

export function cdnUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (!CDN_BASE) return url
  const idx = url.indexOf(STORAGE_MARKER)
  if (idx === -1) return url
  // 仅重写 Supabase 主机，避免把其它来源的同路径 URL 误代理过去
  if (!/^https?:\/\/[a-z0-9-]+\.supabase\.co/i.test(url)) return url
  return CDN_BASE + url.slice(idx)
}
