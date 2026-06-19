// lib/mengmegzi/image-pipeline.ts
//
// 服务端图片处理：下载 image-sources 给的「已是目标尺寸/格式」的主图(+可选缩略图) → 上传 Storage。
// 压缩职责在 image-sources：
//   · danbooru —— 用 850px sample（large_file_url），原格式直传、无独立缩略图
//   · unsplash —— imgix 参数返回压好的 webp 主图 + 640 webp 缩略图
// 本层不依赖 sharp（曾导致 Vercel 构建期 micromatch 爆栈，且 lambda 运行时拿不到会静默不压缩），
// 只负责下载 + 上传 + 算 ratio + 拼缩略图路径。
// 主图任一步失败返回 null（调用方降级纯文字帖）；缩略图失败不阻断（卡片 onError 回退主图）。

import { createClient } from "@supabase/supabase-js"
import { POSTS_BUCKET, MENGMEGZI_STORAGE_PREFIX } from "./constants"
import { postThumbName } from "@/lib/post-image-thumb"
import type { ImageResult } from "./image-sources"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export interface ProcessedImage {
  publicUrl: string
  ratio: number
}

/** 下载一个 URL 为 Buffer。失败返回 null。 */
async function download(url: string): Promise<Buffer | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) {
    console.warn("[mengmegzi] 图片下载失败:", res.status)
    return null
  }
  return Buffer.from(await res.arrayBuffer())
}

/**
 * 下载 image-sources 给的主图(+可选缩略图) 并上传 Storage，返回自己的 CDN URL + 宽高比。
 * 主图任一步失败返回 null（调用方降级纯文字帖）。
 *
 * @param img    image-sources 返回的 { imageUrl, thumbUrl?, ext, contentType, width, height }
 * @param fileId 用于拼 Storage 文件名（mengmegzi-<fileId>.<ext>，桶根目录）
 */
export async function downloadCompressUpload(
  img: ImageResult,
  fileId: string,
): Promise<ProcessedImage | null> {
  try {
    // 1. 主图
    const mainBuf = await download(img.imageUrl)
    if (!mainBuf) return null

    // image_ratio 全站约定 = height/width（消费端 post-card-image 等按此取倒数渲染）
    const ratio = img.width > 0 && img.height > 0 ? img.height / img.width : 1

    // 2. 上传主图：桶根目录 + mengmegzi- 前缀文件名（满足缩略图约定的单段路径要求）；缓存 1 年
    const mainName = `${MENGMEGZI_STORAGE_PREFIX}-${fileId}.${img.ext}`
    const { error: upErr } = await supabaseAdmin.storage
      .from(POSTS_BUCKET)
      .upload(mainName, mainBuf, {
        contentType: img.contentType,
        upsert: true,
        cacheControl: "31536000",
      })
    if (upErr) {
      console.warn("[mengmegzi] Storage 上传失败:", upErr.message)
      return null
    }

    // 3. 缩略图：仅当源提供了 webp 缩略图 URL（如 unsplash）；danbooru 无、跳过。失败不阻断。
    if (img.thumbUrl) {
      try {
        const thumbName = postThumbName(mainName) // mengmegzi-xxx.webp → mengmegzi-xxx_thumb.webp
        if (thumbName) {
          const thumbBuf = await download(img.thumbUrl)
          if (thumbBuf) {
            await supabaseAdmin.storage.from(POSTS_BUCKET).upload(thumbName, thumbBuf, {
              contentType: "image/webp",
              upsert: true,
              cacheControl: "31536000",
            })
          }
        }
      } catch (e: any) {
        console.warn("[mengmegzi] 缩略图生成失败（不影响发帖）:", e?.message || e)
      }
    }

    const { data } = supabaseAdmin.storage.from(POSTS_BUCKET).getPublicUrl(mainName)
    return { publicUrl: data.publicUrl, ratio }
  } catch (e: any) {
    console.warn("[mengmegzi] 图片管线异常:", e?.message || e)
    return null
  }
}
