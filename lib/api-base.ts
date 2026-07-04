/**
 * 统一拼接前端调用后端 API 的 URL。
 *
 * 背景：项目同时跑在两种宿主里
 * 1. Web（Vercel + 自己的域名）—— fetch 走相对路径就行，浏览器自然落到同源
 * 2. Capacitor Android APK —— WebView 里相对路径会解析成 `https://localhost/...`,
 *    打不到线上服务。构建 APK 时通过 NEXT_PUBLIC_API_BASE_URL 注入线上 origin
 *    （形如 "https://your-domain.com"），让 fetch 走绝对路径
 *
 * 用法：
 *   import { apiUrl } from "@/lib/api-base"
 *   fetch(apiUrl("/api/ai-reply"), { ... })
 *
 * 注意：path 必须以 "/" 开头，函数不会自作主张加斜杠
 */
export const API_BASE: string =
  (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/, "")

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) {
    // 抛出比静默拼错更安全：暴露调用方写法错误
    throw new Error(`apiUrl(): path 必须以 "/" 开头，收到: ${path}`)
  }
  return `${API_BASE}${path}`
}
