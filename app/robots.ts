import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/site-url"

// 生成 /robots.txt：放行公开页，屏蔽后台 / API / 登录注册 / 个人页（这些没必要被收录，
// 也避免浪费爬虫抓取额度），并指向 sitemap 让搜索引擎知道完整页面清单。
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/api",
        "/login",
        "/register",
        "/forgot-password",
        "/notifications",
        "/profile",
        "/user",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
