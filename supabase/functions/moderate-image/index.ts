// Supabase Edge Function: moderate-image
//
// 【先发后审 / 异步审核】帖子发布后，由数据库 Webhook(posts 表 INSERT)触发本函数：
//   - 用 service role 在后台对帖子图片做色情/裸露检测(Sightengine)；
//   - 判定违规 → 删帖 + 删图 + 给作者写一条 post_removed 通知；
//   - 判定正常 / 无图片 → 什么都不做。
// 因此用户发帖是"秒发"，审核在后台跑(代价：违规图会短暂公开几秒再被撤下)。
//
// 这是 Webhook 的后台目标、不面向客户端，所以：
//   - 函数关闭 JWT 校验(verify_jwt = false)；
//   - 改用共享密钥头 x-moderation-secret 鉴权，防止被任意公开调用。
//
// 依赖的环境变量(Edge Function Secrets)：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY —— Supabase 自动注入，无需手动配；
//   SIGHTENGINE_API_USER / SIGHTENGINE_API_SECRET —— 手动配置；
//   MODERATION_WEBHOOK_SECRET —— 手动配置，需与数据库 Webhook 里设置的同名请求头一致。

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const SIGHTENGINE_API_USER = Deno.env.get("SIGHTENGINE_API_USER") ?? ""
const SIGHTENGINE_API_SECRET = Deno.env.get("SIGHTENGINE_API_SECRET") ?? ""
const MODERATION_WEBHOOK_SECRET = Deno.env.get("MODERATION_WEBHOOK_SECRET") ?? ""

// ── 可调策略 ────────────────────────────────────────────────────────────────
// 1) 露骨色情判定阈值(0~1)：sexual_activity / sexual_display / erotica 三类里
//    任意一类概率 ≥ 此值即判违规。调高 = 更宽松，调低 = 更严格。
const EXPLICIT_THRESHOLD = 0.5
// 2) 是否额外拦截"强烈性暗示"(very_suggestive，如比基尼/内衣)。
//    null = 不拦，只挡真正的色情；想更严就设成 0.8 这类数值。
const VERY_SUGGESTIVE_THRESHOLD: number | null = null
// 3) 审核服务异常(密钥错/Sightengine 故障)时的策略：
//    false = 保留帖子(降级：不误删用户正常帖，但违规图会留着 —— 默认)；
//    true  = 删除帖子(零漏网，但第三方故障期会误删正常帖)。
const DELETE_ON_MODERATION_ERROR = false
// ────────────────────────────────────────────────────────────────────────────

const NOTIFY_MESSAGE = "你发布的帖子因图片含有违规内容，已被系统自动移除。"

// 本项目 post-images 公开桶的 URL 前缀，用于从 image_url 反解出存储路径来删图。
const POST_IMAGES_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/post-images/`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

const num = (v: unknown) => (typeof v === "number" ? v : 0)

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  // 鉴权：必须带正确的共享密钥头，否则拒绝(防止函数被公开滥用)
  const secret = req.headers.get("x-moderation-secret") ?? ""
  if (!MODERATION_WEBHOOK_SECRET || secret !== MODERATION_WEBHOOK_SECRET) {
    return json({ error: "unauthorized" }, 401)
  }

  // 解析数据库 Webhook 负载：{ type, table, record, old_record, schema }
  let record: Record<string, unknown> | null = null
  try {
    const body = await req.json()
    record = (body?.record ?? null) as Record<string, unknown> | null
  } catch {
    return json({ error: "bad payload" }, 400)
  }

  const postId = typeof record?.id === "string" ? record.id : ""
  const userId = typeof record?.user_id === "string" ? record.user_id : ""
  const imageUrl = typeof record?.image_url === "string" ? (record.image_url as string) : ""

  // 无图片的帖子：无需审核，直接放过(不消耗 Sightengine 额度)
  if (!imageUrl) return json({ skipped: "no image" })

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 密钥没配好：按降级策略处理
  if (!SIGHTENGINE_API_USER || !SIGHTENGINE_API_SECRET) {
    console.error("[moderate-image] Sightengine 密钥未配置，按降级策略处理")
    if (DELETE_ON_MODERATION_ERROR) await removePost(admin, postId, userId, imageUrl)
    return json({ degraded: true, reason: "not configured" })
  }

  // 调 Sightengine 裸露检测(nudity-2.1，1 次请求 = 1 次额度)
  let data: any
  try {
    const params = new URLSearchParams({
      url: imageUrl,
      models: "nudity-2.1",
      api_user: SIGHTENGINE_API_USER,
      api_secret: SIGHTENGINE_API_SECRET,
    })
    const res = await fetch(`https://api.sightengine.com/1.0/check.json?${params.toString()}`)
    data = await res.json()
  } catch (e) {
    console.error("[moderate-image] Sightengine 请求失败:", e)
    if (DELETE_ON_MODERATION_ERROR) await removePost(admin, postId, userId, imageUrl)
    return json({ degraded: true, reason: "request failed" })
  }

  if (data?.status !== "success") {
    console.error("[moderate-image] Sightengine 返回错误:", data?.error)
    if (DELETE_ON_MODERATION_ERROR) await removePost(admin, postId, userId, imageUrl)
    return json({ degraded: true, reason: data?.error?.message ?? "moderation error" })
  }

  // 判定
  const n = data.nudity ?? {}
  const explicit = Math.max(num(n.sexual_activity), num(n.sexual_display), num(n.erotica))
  let blocked = explicit >= EXPLICIT_THRESHOLD
  if (!blocked && VERY_SUGGESTIVE_THRESHOLD !== null && num(n.very_suggestive) >= VERY_SUGGESTIVE_THRESHOLD) {
    blocked = true
  }

  if (blocked) {
    await removePost(admin, postId, userId, imageUrl)
    return json({ removed: true, score: Number(explicit.toFixed(4)) })
  }

  return json({ allowed: true, score: Number(explicit.toFixed(4)) })
})

// 删帖 + 删图 + 通知作者。各步独立 try，单步失败不影响其余步骤。
async function removePost(
  admin: SupabaseClient,
  postId: string,
  userId: string,
  imageUrl: string,
): Promise<void> {
  // 1) 删存储里的违规图(仅当确属本项目 post-images 桶)
  if (imageUrl.startsWith(POST_IMAGES_PREFIX)) {
    try {
      const path = decodeURIComponent(imageUrl.slice(POST_IMAGES_PREFIX.length).split("?")[0])
      const { error } = await admin.storage.from("post-images").remove([path])
      if (error) console.error("[moderate-image] 删图失败:", error)
    } catch (e) {
      console.error("[moderate-image] 删图异常:", e)
    }
  }

  // 2) 删帖
  if (postId) {
    const { error } = await admin.from("posts").delete().eq("id", postId)
    if (error) console.error("[moderate-image] 删帖失败:", error)
  }

  // 3) 通知作者(post_id 置空，避免被删帖级联带走；类型 post_removed)
  if (userId) {
    const { error } = await admin.from("notifications").insert({
      user_id: userId,
      type: "post_removed",
      post_id: null,
      comment_id: null,
      actor_id: null,
      message: NOTIFY_MESSAGE,
      is_read: false,
    })
    if (error) console.error("[moderate-image] 写通知失败:", error)
  }
}
