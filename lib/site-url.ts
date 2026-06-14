/**
 * 站点正式对外地址（canonical origin）与基础信息，供 SEO 元数据 / sitemap / robots 共用。
 *
 * 这里写死生产域名：搜索引擎需要一个稳定、绝对的 URL，不能随 Vercel 预览域名变化，
 * 也不能依赖 lib/api-base 的 NEXT_PUBLIC_API_BASE_URL —— 那个只在 Capacitor APK
 * 构建时注入、Web 构建下为空字符串，用于 SEO 会拼出错误链接。
 *
 * 换正式域名时只改这一处。
 */
export const SITE_URL = "https://forum.hanakos.cc"
export const SITE_NAME = "萤火虫之国"
export const SITE_DESCRIPTION = "分享想法 · 探索音乐"
