// 帖子图「主体遮罩」文件名约定，照搬 lib/post-image-thumb.ts 的做法。
// 遮罩是灰度 PNG（主体≈白、背景≈黑），与主图同桶（post-images），按 `_mask.png` 命名。
// 用于「主体视差」效果（components/subject-parallax + lib/anime-matte）。
// 渲染端以帖子的 image_mask_url 列为准；本文件只负责发帖时的命名/解析。

export const POST_MASK_SUFFIX = "_mask"
export const POST_MASK_EXT = "png"

// 主图存储文件名 → 遮罩文件名（abc.webp → abc_mask.png）。GIF 不做遮罩。
export function postMaskName(mainName: string): string | null {
  if (/\.gif$/i.test(mainName)) return null
  const dot = mainName.lastIndexOf(".")
  const base = dot > 0 ? mainName.slice(0, dot) : mainName
  return `${base}${POST_MASK_SUFFIX}.${POST_MASK_EXT}`
}

// 从主图 public URL 取出 post-images 桶内的存储对象名（无子目录）。
// 例：https://x.supabase.co/storage/v1/object/public/post-images/abc.webp → abc.webp
export function postImageObjectName(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null
  const marker = "/post-images/"
  const idx = imageUrl.indexOf(marker)
  if (idx === -1) return null
  const name = decodeURIComponent(imageUrl.slice(idx + marker.length).split("?")[0])
  if (!name || name.includes("/")) return null
  return name
}
