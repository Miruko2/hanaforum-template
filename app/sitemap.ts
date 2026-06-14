import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/site-url"

// 生成 /sitemap.xml：给搜索引擎当「目录」，只列公开、可被收录的页面。
// 登录/个人/后台页不放这里（见 robots.ts 的 disallow）。新增公开页时往下面加一条即可。
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/music`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/download`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.7,
    },
  ]
}
