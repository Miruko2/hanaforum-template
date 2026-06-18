// lib/mengmegzi/image-pipeline.ts
//
// 服务端图片处理：外部 URL → 下载 → sharp 压缩 → 上传 Supabase Storage。
// 复用客户端 lib/image-compress.ts 的参数（maxEdge 1920 / quality 82 / webp）。
// 任何步骤失败返回 null，调用方降级纯文字帖。
//
// sharp 不在 package.json 里声明依赖：它在 Vercel 运行时由 Next.js 自带
// （Next 图片优化用 sharp）。这里运行时动态 require，拿不到就跳过压缩用原图。
// 这样构建时 file tracing 不会扫到 sharp 的原生依赖树（曾导致 Vercel 上
// micromatch 在 Collecting build traces 阶段栈溢出）。

import { createClient } from "@supabase/supabase-js"
import { IMAGE_MAX_EDGE, IMAGE_QUALITY, POSTS_BUCKET, MENGMEGZI_STORAGE_PREFIX } from "./constants"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** 运行时拿 sharp（Vercel 运行时由 Next 自带）；拿不到返回 null */
function getSharp(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("sharp")
  } catch {
    return null
  }
}

export interface ProcessedImage {
  publicUrl: string
  ratio: number
}

/**
 * 下载外部图 + sharp 压缩 + 上传 Storage，返回自己的 CDN URL + 宽高比。
 * 任何步骤失败返回 null（调用方降级纯文字帖）。
 *
 * @param imageUrl 外部图片直链
 * @param postId   用于拼 Storage 路径（mengmegzi/<postId>.webp）
 */
export async function downloadCompressUpload(
  imageUrl: string,
  postId: string,
): Promise<ProcessedImage | null> {
  try {
    // 1. 下载（15s 超时防卡死）
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      console.warn("[mengmegzi] 图片下载失败:", res.status)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())

    // 2. 拿 sharp（运行时由 Next 自带）；拿不到就用原图
    const sharp = getSharp()
    let outBuf = buf
    let contentType = "image/jpeg"
    let ext = "jpg"
    let ratio = 1

    if (sharp) {
      // 读原始宽高算 ratio（前端按比例占位防抖）
      const meta = await sharp(buf).metadata()
      ratio = meta.width && meta.height ? meta.width / meta.height : 1
      // 压缩：resize 限最大边 + webp（参数与客户端 compressImage 一致）
      outBuf = await sharp(buf)
        .resize(IMAGE_MAX_EDGE, IMAGE_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: IMAGE_QUALITY })
        .toBuffer()
      contentType = "image/webp"
      ext = "webp"
    } else {
      console.warn("[mengmegzi] sharp 不可用，跳过压缩用原图上传")
      // 无 sharp 时 ratio 拿不到，用 1 占位（前端会自适应）
    }

    // 3. 上传 Storage（mengmegzi/ 前缀，方便日后清理）
    const path = `${MENGMEGZI_STORAGE_PREFIX}/${postId}.${ext}`
    const { error: upErr } = await supabaseAdmin.storage
      .from(POSTS_BUCKET)
      .upload(path, outBuf, { contentType, upsert: true })
    if (upErr) {
      console.warn("[mengmegzi] Storage 上传失败:", upErr.message)
      return null
    }

    const { data } = supabaseAdmin.storage.from(POSTS_BUCKET).getPublicUrl(path)
    return { publicUrl: data.publicUrl, ratio }
  } catch (e: any) {
    console.warn("[mengmegzi] 图片管线异常:", e?.message || e)
    return null
  }
}
