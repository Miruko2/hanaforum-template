"use client"

import { cachedQuery } from "./cache-utils"
import { apiUrl } from "./api-base"

// 注：本文件目前是 dead code（全项目没人 import optimizeImage），
// 且引用的 /api/image 路由也不存在。保留是为了将来可能的图片优化方案。
// 此处用 apiUrl() 包裹路径只是为了和其它前端 API 调用统一，未来真要启用
// 这条链路时不会忘记加 NEXT_PUBLIC_API_BASE_URL 前缀。

/**
 * 优化图片
 * @param url 原始图片URL
 * @param width 目标宽度
 * @param format 目标格式
 * @returns 优化后的图片数据
 */
export async function optimizeImage(
  url: string,
  width = 800,
  format: "webp" | "jpeg" | "png" = "webp",
): Promise<ArrayBuffer> {
  // 使用缓存查询
  return cachedQuery(
    `image:${url}:${width}:${format}`,
    async () => {
      try {
        // 构建 API URL（apiUrl 工具会在 APK 构建时自动加上 NEXT_PUBLIC_API_BASE_URL）
        const reqUrl = apiUrl(
          `/api/image?url=${encodeURIComponent(url)}&width=${width}&format=${format}`,
        )

        // 获取图片
        const response = await fetch(reqUrl)

        if (!response.ok) {
          throw new Error(`图片优化失败: ${response.statusText}`)
        }

        // 返回图片数据
        return await response.arrayBuffer()
      } catch (error) {
        console.error("图片优化失败:", error)

        // 如果优化失败，尝试直接获取原始图片
        const response = await fetch(url)
        return await response.arrayBuffer()
      }
    },
    // 缓存24小时
    86400,
  )
}

/**
 * 获取图片尺寸
 * @param url 图片URL
 * @returns 图片尺寸 {width, height}
 */
export function getImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve({
        width: img.width,
        height: img.height,
      })
    }
    img.onerror = () => {
      reject(new Error("获取图片尺寸失败"))
    }
    img.src = url
    img.crossOrigin = "anonymous"
  })
}

/**
 * 计算图片比例
 * @param url 图片URL
 * @returns 图片比例 (height/width)
 */
export async function getImageRatio(url: string): Promise<number> {
  try {
    const { width, height } = await getImageDimensions(url)
    return height / width
  } catch (error) {
    console.error("计算图片比例失败:", error)
    // 默认返回16:9的比例
    return 9 / 16
  }
}
