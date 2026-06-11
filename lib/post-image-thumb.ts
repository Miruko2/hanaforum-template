// lib/post-image-thumb.ts
//
// 帖子图缩略图路径约定：主图 `abc123.webp` → 缩略图 `abc123_thumb.webp`（同桶根目录）。
//
// 背景：Vercel Image Optimization 免费额度爆掉后 /_next/image 对新图直接 502，
// 帖子图全面改回原生 <img> 直连 Supabase。为免列表卡片直接拉 1920px 主图烧
// Supabase egress，上传时同步生成 640px 缩略图：卡片/影院模式/时间线用缩略图，
// 点开灯箱才加载原图。
//
// 老帖子没有缩略图、GIF 不生成缩略图（canvas 压缩会丢动画）——消费端一律
// 「先试缩略图，onError 回退主图」，所以这里的推导只管"按约定拼路径"，不保证存在。
//
// ⚠️ 同一约定还硬编码在三处（.mjs/Deno 无法 import 本 TS 文件），改动需同步：
//   - scripts/cleanup-orphan-post-images.mjs（主图被引用 ⇒ 对应缩略图也算被引用）
//   - scripts/backfill-post-image-thumbs.mjs（给存量主图回填缩略图）
//   - supabase/functions/moderate-image/index.ts（违规删主图时连带删缩略图）

export const POST_THUMB_SUFFIX = "_thumb"
/** 缩略图统一存 webp 路径（客户端 toBlob/服务端 sharp 都输出 webp） */
export const POST_THUMB_EXT = "webp"
/** 缩略图最大边：列表卡片最宽约 400px 出头，640 足够 2x 屏 */
export const POST_THUMB_EDGE = 640

/** 主图存储文件名 → 缩略图文件名：abc.webp → abc_thumb.webp；GIF 返回 null（不生成） */
export function postThumbName(mainName: string): string | null {
  if (/\.gif$/i.test(mainName)) return null
  const dot = mainName.lastIndexOf(".")
  const base = dot > 0 ? mainName.slice(0, dot) : mainName
  return `${base}${POST_THUMB_SUFFIX}.${POST_THUMB_EXT}`
}

/** 帖子主图 public URL → 缩略图 URL；非 post-images 桶、GIF、解析失败返回 null */
export function postThumbUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null
  const marker = "/post-images/"
  const idx = imageUrl.indexOf(marker)
  if (idx === -1) return null
  const prefix = imageUrl.slice(0, idx + marker.length)
  const name = decodeURIComponent(imageUrl.slice(idx + marker.length).split("?")[0])
  if (!name || name.includes("/")) return null
  const thumb = postThumbName(name)
  return thumb ? prefix + thumb : null
}
