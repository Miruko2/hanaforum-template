// lib/post-images.ts
//
// 帖子图片列表归一化：多图存在 posts.image_urls（按上传顺序，第一张=封面），
// 单图老帖只有 image_url。消费端统一用 postImageList 取「有序图片数组」，
// 不必各处判空回退。
//
// 约定：image_urls 非空时以它为准（已含封面在首位）；否则回退 [image_url]；
//      都没有则返回空数组。

import { supabase } from "./supabaseClient"

export type PostImageSource = {
  image_url?: string | null
  image_urls?: string[] | null
}

// 缓存「posts 表是否已有 image_urls 列」的探测结果。
// 多图迁移(scripts/2026-06-14-post-multi-images.sql)执行前该列不存在，
// 若在 select/insert 里引用它，PostgREST 会让整表查询报错 → 帖子列表空白。
// 这里只探测一次并缓存，使代码在「迁移前/迁移后」都能正常工作：
//   · 迁移前：探测失败 → 各查询自动回退到不含 image_urls 的旧查询（站点照常）；
//   · 迁移后：探测成功 → 自动启用多图读写。
let columnCheck: Promise<boolean> | null = null
export function postsHaveImageUrls(): Promise<boolean> {
  if (!columnCheck) {
    columnCheck = (async () => {
      try {
        const { error } = await supabase.from("posts").select("image_urls").limit(1)
        return !error
      } catch {
        return false
      }
    })()
  }
  return columnCheck
}

// 同理探测 posts 是否已有 image_mask_url 列（主体视差用，scripts/2026-06-20-post-image-mask.sql）。
// feed 的显式 select 引用不存在的列会让整表查询报错 → 帖子列表空白，故同样探测+缓存+回退。
let maskColumnCheck: Promise<boolean> | null = null
export function postsHaveMaskColumn(): Promise<boolean> {
  if (!maskColumnCheck) {
    maskColumnCheck = (async () => {
      try {
        const { error } = await supabase.from("posts").select("image_mask_url").limit(1)
        return !error
      } catch {
        return false
      }
    })()
  }
  return maskColumnCheck
}

/** 取帖子的有序图片列表（封面在首位）。无图返回 []。 */
export function postImageList(post: PostImageSource): string[] {
  const list = Array.isArray(post.image_urls)
    ? post.image_urls.filter((u): u is string => typeof u === "string" && u.length > 0)
    : []
  if (list.length > 0) return list
  return post.image_url ? [post.image_url] : []
}

/** 帖子是否为多图（用于显示「多图」角标 / 启用轮播）。 */
export function isMultiImage(post: PostImageSource): boolean {
  return postImageList(post).length > 1
}
