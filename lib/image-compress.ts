// lib/image-compress.ts
//
// 上传前客户端压缩：限制最大边 + 转 webp + 降质量，把动辄数 MB 的原图压到几百 KB，
// 从源头降低 Supabase Storage 占用与出站流量（Cached Egress）。
// 帖子图（create-post-modal，1920/0.82）与头像（profile，256/0.8）共用，靠参数区分。
//
// 兜底原则——绝不因压缩失败阻断上传：
//   · GIF 跳过（canvas 会丢掉动画）；
//   · 解码 / toBlob 失败、或压完反而更大（少数已高度优化的小图）→ 退回原文件；
//   · ext / contentType 跟实际 blob.type 走（iOS 老 Safari 不支持 webp 编码时
//     toBlob 会回退，此时不会错标成 webp）。

export async function compressImage(
  file: File,
  maxEdge = 1920,
  quality = 0.82,
): Promise<{ blob: Blob; ext: string; contentType: string }> {
  const passthrough = {
    blob: file,
    ext: file.name.split(".").pop() || "jpg",
    contentType: file.type || "application/octet-stream",
  }
  if (file.type === "image/gif") return passthrough
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error("read failed"))
      reader.readAsDataURL(file)
    })
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error("decode failed"))
      im.src = dataUrl
    })
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * scale))
    const h = Math.max(1, Math.round(img.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return passthrough
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/webp", quality),
    )
    if (!blob || blob.size >= file.size) return passthrough
    const ext =
      blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg"
    return { blob, ext, contentType: blob.type }
  } catch {
    return passthrough
  }
}
