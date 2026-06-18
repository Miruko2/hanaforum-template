// lib/mengmegzi/image-pipeline.ts
//
// 服务端图片处理：外部 URL → 下载 → sharp 压缩 → 上传 Supabase Storage。
// 复用客户端 lib/image-compress.ts 的参数（maxEdge 1920 / quality 82 / webp）。
// 任何步骤失败返回 null，调用方降级纯文字帖。

import sharp from "sharp"
import { createClient } from "@supabase/supabase-js"
import { IMAGE_MAX_EDGE, IMAGE_QUALITY, POSTS_BUCKET, MENGMEGZI_STORAGE_PREFIX } from "./constants"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

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

    // 2. 读原始宽高算 ratio（前端按比例占位防抖）
    const meta = await sharp(buf).metadata()
    const ratio = meta.width && meta.height ? meta.width / meta.height : 1

    // 3. 压缩：resize 限最大边 + webp（参数与客户端 compressImage 一致）
    const compressed = await sharp(buf)
      .resize(IMAGE_MAX_EDGE, IMAGE_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: IMAGE_QUALITY })
      .toBuffer()

    // 4. 上传 Storage（mengmegzi/ 前缀，方便日后清理）
    const path = `${MENGMEGZI_STORAGE_PREFIX}/${postId}.webp`
    const { error: upErr } = await supabaseAdmin.storage
      .from(POSTS_BUCKET)
      .upload(path, compressed, { contentType: "image/webp", upsert: true })
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
