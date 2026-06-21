// Supabase Edge Function: send-push
//
// 【系统推送通知】由数据库 Webhook 触发：
//   - notifications(INSERT) → 推给 record.user_id（站内通知：@提及/引用/点赞/友链申请/审核等）
//   - dm_messages(INSERT)   → 推给 record.recipient_id（私信）
//   用 service role 查收件人的 FCM 设备 token，调 FCM HTTP v1 发系统通知。
//   token 失效（UNREGISTERED / INVALID_ARGUMENT / 404）→ 顺手从 push_tokens 删掉。
//
// 鉴权：非客户端面向，部署时关 JWT（--no-verify-jwt），用共享密钥头 x-push-secret 校验。
//
// 依赖 Secrets（Edge Function Secrets）：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY —— 平台自动注入；
//   PUSH_WEBHOOK_SECRET —— 与两个 Webhook 的请求头 x-push-secret 一致；
//   FCM_PROJECT_ID      —— Firebase 项目 ID；
//   FCM_CLIENT_EMAIL    —— 服务账号 client_email；
//   FCM_PRIVATE_KEY     —— 服务账号 private_key（PEM；换行用字面 \n 存，下方会还原）。

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
// 防「复制密钥时混入首尾空格/换行」这类静默失配的坑：env 一律 trim 后再用
// （私钥先把字面 \n 还原成真换行，再 trim 掉首尾空白；内部空白由 pemToArrayBuffer 兜底清理）。
const PUSH_WEBHOOK_SECRET = (Deno.env.get("PUSH_WEBHOOK_SECRET") ?? "").trim()
const FCM_PROJECT_ID = (Deno.env.get("FCM_PROJECT_ID") ?? "").trim()
const FCM_CLIENT_EMAIL = (Deno.env.get("FCM_CLIENT_EMAIL") ?? "").trim()
const FCM_PRIVATE_KEY = (Deno.env.get("FCM_PRIVATE_KEY") ?? "").replace(/\\n/g, "\n").trim()

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── FCM OAuth2 access token（服务账号 JWT → access_token，内存缓存约 1 小时）────
let cachedToken = { value: "", exp: 0 }

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "")
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function b64url(data: string | ArrayBuffer): string {
  const s = typeof data === "string"
    ? btoa(data)
    : btoa(String.fromCharCode(...new Uint8Array(data)))
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken.value && cachedToken.exp - 60 > now) return cachedToken.value

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const claim = b64url(JSON.stringify({
    iss: FCM_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${claim}`
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(FCM_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  )
  const jwt = `${unsigned}.${b64url(sig)}`

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const data = await res.json()
  if (!res.ok || !data.access_token) {
    throw new Error(`FCM token error: ${res.status} ${JSON.stringify(data)}`)
  }
  cachedToken = { value: data.access_token, exp: now + (data.expires_in ?? 3600) }
  return cachedToken.value
}

// ── 发一条 FCM 通知到单个 token；返回是否成功 + 该 token 是否已失效 ──────────
async function sendToToken(
  accessToken: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<{ ok: boolean; dead: boolean }> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data,
          android: {
            priority: "HIGH",
            notification: { sound: "default", default_vibrate_timings: true },
          },
        },
      }),
    },
  )
  if (res.ok) return { ok: true, dead: false }
  const err = await res.json().catch(() => ({} as Record<string, unknown>))
  const status = (err as { error?: { status?: string } })?.error?.status ?? ""
  const dead = res.status === 404 ||
    status === "UNREGISTERED" || status === "NOT_FOUND" || status === "INVALID_ARGUMENT"
  console.warn(`[send-push] FCM fail ${res.status} ${status}`)
  return { ok: false, dead }
}

// ── 文案：根据来源表拼标题/正文/点击跳转 url ──────────────────────────────────
const NOTIF_TITLES: Record<string, string> = {
  chat_mention: "有人提到了你",
  like_post: "新的点赞",
  comment_post: "新的评论",
  like_comment: "新的点赞",
  follow: "新的关注",
  friend_link_apply: "友链申请",
  moderation: "内容审核",
}

async function buildPush(
  table: string,
  record: Record<string, unknown>,
): Promise<{ recipient: string; title: string; body: string; data: Record<string, string> } | null> {
  if (table === "dm_messages") {
    const senderId = String(record.sender_id ?? "")
    const recipient = String(record.recipient_id ?? "")
    if (!recipient || senderId === recipient) return null
    let name = "新私信"
    const { data: prof } = await admin
      .from("profiles").select("username").eq("id", senderId).maybeSingle()
    if (prof?.username) name = String(prof.username)
    const body = record.kind === "sticker"
      ? "[贴纸]"
      : String(record.content ?? "").slice(0, 100)
    return {
      recipient,
      title: name,
      body: body || "发来一条消息",
      data: { kind: "dm", senderId, url: "/chat" },
    }
  }
  // notifications
  const recipient = String(record.user_id ?? "")
  if (!recipient) return null
  const type = String(record.type ?? "")
  return {
    recipient,
    title: NOTIF_TITLES[type] ?? "新通知",
    body: String(record.message ?? "你有一条新通知").slice(0, 140),
    data: { kind: "notification", type, url: "/notifications" },
  }
}

Deno.serve(async (req) => {
  // ── 健康自检：GET + 正确 x-push-secret → 只验证 FCM 服务账号凭据能否换到 access_token，
  //    不发任何推送。用来在「没装 APK / 还没有设备 token」时，提前抓出
  //    密钥少填 / 混入空格换行 / 私钥格式错 这类问题。
  if (req.method === "GET") {
    if (PUSH_WEBHOOK_SECRET && (req.headers.get("x-push-secret") ?? "").trim() !== PUSH_WEBHOOK_SECRET) {
      return json({ ok: false, error: "unauthorized (x-push-secret 不匹配)" }, 401)
    }
    const missing: string[] = []
    if (!FCM_PROJECT_ID) missing.push("FCM_PROJECT_ID")
    if (!FCM_CLIENT_EMAIL) missing.push("FCM_CLIENT_EMAIL")
    if (!FCM_PRIVATE_KEY) missing.push("FCM_PRIVATE_KEY")
    if (missing.length) return json({ ok: false, missing })
    try {
      await getAccessToken()
      return json({
        ok: true,
        projectId: FCM_PROJECT_ID,
        clientEmail: FCM_CLIENT_EMAIL,
        privateKeyLooksPem: FCM_PRIVATE_KEY.startsWith("-----BEGIN PRIVATE KEY-----"),
      })
    } catch (e) {
      return json({ ok: false, stage: "getAccessToken", error: String(e) })
    }
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  // 共享密钥校验（配置了才校验）
  if (PUSH_WEBHOOK_SECRET) {
    if ((req.headers.get("x-push-secret") ?? "").trim() !== PUSH_WEBHOOK_SECRET) {
      return json({ error: "unauthorized" }, 401)
    }
  }

  let payload: { type?: string; table?: string; record?: Record<string, unknown> }
  try {
    payload = await req.json()
  } catch {
    return json({ error: "bad json" }, 400)
  }

  const table = payload?.table ?? ""
  const record = payload?.record
  if (payload?.type !== "INSERT" || !record) return json({ skipped: "not an insert" })
  if (table !== "notifications" && table !== "dm_messages") return json({ skipped: "unhandled table" })

  const push = await buildPush(table, record)
  if (!push) return json({ skipped: "no recipient" })

  // 拉收件人所有设备 token
  const { data: rows, error } = await admin
    .from("push_tokens").select("token").eq("user_id", push.recipient)
  if (error) return json({ error: error.message }, 500)
  const tokens = (rows ?? []).map((r) => String(r.token)).filter(Boolean)
  if (tokens.length === 0) return json({ skipped: "no tokens" })

  if (!FCM_PROJECT_ID || !FCM_CLIENT_EMAIL || !FCM_PRIVATE_KEY) {
    return json({ error: "FCM secrets not configured" }, 500)
  }

  let accessToken: string
  try {
    accessToken = await getAccessToken()
  } catch (e) {
    return json({ error: String(e) }, 500)
  }

  const dead: string[] = []
  let sent = 0
  await Promise.all(tokens.map(async (t) => {
    const r = await sendToToken(accessToken, t, push.title, push.body, push.data)
    if (r.ok) sent++
    else if (r.dead) dead.push(t)
  }))

  if (dead.length) {
    await admin.from("push_tokens").delete().in("token", dead)
  }

  return json({ sent, dead: dead.length, total: tokens.length })
})
