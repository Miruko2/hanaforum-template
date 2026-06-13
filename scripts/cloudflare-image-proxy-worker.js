// ============================================================
// Cloudflare Worker：Supabase Storage 图片缓存代理 - 2026-06-13
//
// 目的：Supabase Cached Egress 爆 5GB 配额（自家 CDN 命中也计费）。
//      此 Worker 部署在自有域名上，把图片缓存在 Cloudflare 边缘
//      （免费、不计流量），只在边缘未命中时回源 Supabase 一次。
//      图片文件名带时间戳（内容不可变），可放心缓存 1 年。
//
// 部署步骤（Cloudflare Dashboard）：
// 1. 域名接入 Cloudflare（DNS 托管）
// 2. Workers & Pages → Create Worker → 粘贴本文件 → Deploy
// 3. Worker → Settings → Domains & Routes → 添加自定义域，
//    如 img.example.com（自动建 DNS，无需手动加记录）
// 4. 项目 .env.local / Vercel 环境变量加：
//    NEXT_PUBLIC_IMG_CDN_BASE=https://img.example.com
//    重新部署前端即生效（未配置时前端自动直连 Supabase，可随时回退）
//
// 免费额度：Workers 10 万请求/天；边缘缓存命中同样消耗请求数但不耗流量配额。
// ============================================================

const ORIGIN = "https://uvkupdbfbnodeybulczd.supabase.co";

// 只代理公开桶的只读对象，防止被当成任意目标的开放代理
const ALLOWED_PREFIX = "/storage/v1/object/public/";

const ONE_YEAR = 31536000;

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith(ALLOWED_PREFIX)) {
      return new Response("Not Found", { status: 404 });
    }

    // 丢弃查询串，统一缓存键（Supabase 公开对象不需要 query）
    const originUrl = ORIGIN + url.pathname;

    const response = await fetch(originUrl, {
      cf: {
        // Cloudflare 边缘缓存：命中后不再回源，Supabase egress 为 0
        cacheEverything: true,
        cacheTtl: ONE_YEAR,
        cacheTtlByStatus: { "200-299": ONE_YEAR, "404": 60, "500-599": 0 },
      },
    });

    // 重写响应头：浏览器侧也缓存 1 年（文件名带时间戳，内容不可变）
    const headers = new Headers(response.headers);
    if (response.ok) {
      headers.set("Cache-Control", `public, max-age=${ONE_YEAR}, immutable`);
    }
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
