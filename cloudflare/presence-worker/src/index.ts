// Cloudflare Worker 入口：校验 Supabase JWT、路由到全局唯一 PresenceRoom DO。
//
// 流程：
//   1. WS Upgrade 请求 → /ws?token=<supabase-access-token>
//   2. jose 用 HS256 + SUPABASE_JWT_SECRET 验签 → 拿到 sub (= user.id)
//   3. 路由到 PRESENCE.idFromName("global") 这一个 DO 实例
//   4. DO 用 Hibernation API 接管 WS（空闲不计 CPU 时间）
//
// 凭证：SUPABASE_JWT_SECRET 由 `wrangler secret put` 注入，不进 git。

import { jwtVerify } from "jose"

export { PresenceRoom } from "./presence-room"

export interface Env {
  PRESENCE: DurableObjectNamespace
  SUPABASE_JWT_SECRET: string
  PRESENCE_ENABLED: string
  ALLOWED_ORIGINS: string
}

function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] || "*"
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin")

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env) })
    }

    // 全局 Kill Switch：环境变量一键停用，无需回滚代码
    if (env.PRESENCE_ENABLED !== "true") {
      return new Response("Presence disabled", { status: 503 })
    }

    const url = new URL(req.url)

    // 健康检查（不计入 DO 请求）
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 })
    }

    if (url.pathname !== "/ws") {
      return new Response("Not Found", { status: 404 })
    }

    // 仅接受 WebSocket Upgrade
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket Upgrade", { status: 426 })
    }

    // 校验 Supabase JWT（HS256 + 共享 secret）
    // 注意：浏览器原生 WebSocket 无法附带 Authorization header，故走 query param
    const token = url.searchParams.get("token")
    if (!token) {
      return new Response("Missing token", { status: 401 })
    }

    let userId: string
    try {
      const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET)
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ["HS256"],
      })
      const sub = payload.sub
      if (typeof sub !== "string" || sub.length === 0) {
        return new Response("Invalid token: no sub", { status: 401 })
      }
      userId = sub
    } catch {
      return new Response("Invalid token", { status: 401 })
    }

    // 路由到全局唯一 DO 实例
    const id = env.PRESENCE.idFromName("global")
    const stub = env.PRESENCE.get(id)

    // 通过内部 header 传递校验后的 userId（DO 信任来自同 Worker 的内部 header）
    const fwd = new Request(req.url, req)
    fwd.headers.set("X-User-Id", userId)
    return stub.fetch(fwd)
  },
}
