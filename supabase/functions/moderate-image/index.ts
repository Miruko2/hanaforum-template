// Supabase Edge Function: moderate-image
//
// 【先发后审 / 异步审核】由数据库 Webhook(posts 表 INSERT + UPDATE)触发本函数：
//   - 用 service role 在后台对帖子图片做色情/裸露检测(Sightengine)；
//   - 新发帖(INSERT)违规 → 删整帖 + 删图 + 通知作者；
//   - 编辑换图(UPDATE)违规 → 只删图(把 image_url 清空)、保留正文 + 通知作者；
//   - 正常 / 无图 / 图片没变 → 什么都不做。
// 因此用户发帖、编辑都是"秒回"，审核在后台跑(代价：违规图会短暂可见几秒再被撤下)。
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
//    false = 保留内容(降级：不误删用户正常帖/图，但违规图会留着 —— 默认)；
//    true  = 按违规处理(零漏网，但第三方故障期会误删正常内容)。
const ENFORCE_ON_MODERATION_ERROR = false
// ────────────────────────────────────────────────────────────────────────────

const MSG_POST_REMOVED = "你发布的帖子因图片含有违规内容，已被系统自动移除。"
const MSG_IMAGE_REMOVED = "你帖子里新更换的图片含有违规内容，已被系统移除。"

// 本项目 post-images 公开桶的 URL 前缀，用于从 image_url 反解出存储路径来删图。
const POST_IMAGES_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/post-images/`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

const num = (v: unknown) => (typeof v === "number" ? v : 0)
const str = (v: unknown) => (typeof v === "string" ? v : "")

// 从一行帖子记录里收集所有图片 URL（封面 image_url + 多图 image_urls），去重去空。
const collectImages = (rec: Record<string, unknown> | null): string[] => {
  if (!rec) return []
  const out: string[] = []
  const push = (v: unknown) => {
    if (typeof v === "string" && v) out.push(v)
  }
  push(rec.image_url)
  const arr = rec.image_urls
  if (Array.isArray(arr)) for (const u of arr) push(u)
  return [...new Set(out)]
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  // 鉴权：必须带正确的共享密钥头，否则拒绝(防止函数被公开滥用)
  const secret = req.headers.get("x-moderation-secret") ?? ""
  if (!MODERATION_WEBHOOK_SECRET || secret !== MODERATION_WEBHOOK_SECRET) {
    return json({ error: "unauthorized" }, 401)
  }

  // 解析数据库 Webhook 负载：{ type, table, record, old_record, schema }
  let payload: any
  try {
    payload = await req.json()
  } catch {
    return json({ error: "bad payload" }, 400)
  }

  const eventType = str(payload?.type) // INSERT | UPDATE | DELETE
  const record = (payload?.record ?? null) as Record<string, unknown> | null
  const oldRecord = (payload?.old_record ?? null) as Record<string, unknown> | null

  // 只处理 INSERT 和 UPDATE
  if (eventType !== "INSERT" && eventType !== "UPDATE") {
    return json({ skipped: "ignored event" })
  }

  const postId = str(record?.id)
  const userId = str(record?.user_id)
  // 多图：审核 image_url(封面) + image_urls(全部图) 去重后的集合。
  const allImages = collectImages(record)
  const oldImages = new Set(collectImages(oldRecord))
  // UPDATE 只审「新增的图」：未变化的图之前审过，避免浪费额度，也避免本函数
  // 改写图片后再次触发 Webhook 造成死循环。
  const toModerate =
    eventType === "UPDATE" ? allImages.filter((u) => !oldImages.has(u)) : allImages

  // 无(新)图片：无需审核，直接放过(不消耗 Sightengine 额度)
  if (toModerate.length === 0) {
    return json({ skipped: eventType === "UPDATE" ? "images unchanged" : "no image" })
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // 密钥没配好：按降级策略处理
  if (!SIGHTENGINE_API_USER || !SIGHTENGINE_API_SECRET) {
    console.error("[moderate-image] Sightengine 密钥未配置，按降级策略处理")
    if (ENFORCE_ON_MODERATION_ERROR) {
      await enforce(admin, eventType, postId, userId, allImages, new Set(toModerate))
    }
    return json({ degraded: true, reason: "not configured" })
  }

  // 逐张调 Sightengine 裸露检测(nudity-2.1，1 张图 = 1 次额度)，收集违规图。
  const blocked = new Set<string>()
  for (const url of toModerate) {
    let data: any
    try {
      const params = new URLSearchParams({
        url,
        models: "nudity-2.1",
        api_user: SIGHTENGINE_API_USER,
        api_secret: SIGHTENGINE_API_SECRET,
      })
      const res = await fetch(`https://api.sightengine.com/1.0/check.json?${params.toString()}`)
      data = await res.json()
    } catch (e) {
      console.error("[moderate-image] Sightengine 请求失败:", e)
      if (ENFORCE_ON_MODERATION_ERROR) blocked.add(url)
      continue
    }

    if (data?.status !== "success") {
      console.error("[moderate-image] Sightengine 返回错误:", data?.error)
      if (ENFORCE_ON_MODERATION_ERROR) blocked.add(url)
      continue
    }

    // 判定
    const n = data.nudity ?? {}
    const explicit = Math.max(num(n.sexual_activity), num(n.sexual_display), num(n.erotica))
    let isBad = explicit >= EXPLICIT_THRESHOLD
    if (!isBad && VERY_SUGGESTIVE_THRESHOLD !== null && num(n.very_suggestive) >= VERY_SUGGESTIVE_THRESHOLD) {
      isBad = true
    }
    if (isBad) blocked.add(url)
  }

  if (blocked.size > 0) {
    await enforce(admin, eventType, postId, userId, allImages, blocked)
    return json({
      removed: eventType === "INSERT" ? "post" : "image",
      blocked: blocked.size,
    })
  }

  return json({ allowed: true, checked: toModerate.length })
})

// 按事件类型执行移除：
//   · 新发帖(INSERT)有任一图违规 → 删整帖 + 删该帖全部图；
//   · 编辑(UPDATE)有图违规 → 仅剔除违规图（保留正文与其余干净图），重算封面。
async function enforce(
  admin: SupabaseClient,
  eventType: string,
  postId: string,
  userId: string,
  allImages: string[],
  blocked: Set<string>,
): Promise<void> {
  if (eventType === "INSERT") {
    await removePost(admin, postId, userId, allImages)
  } else {
    await stripImages(admin, postId, userId, allImages, blocked)
  }
}

// 删整帖 + 删该帖全部图 + 通知作者(用于新发帖违规)。
async function removePost(
  admin: SupabaseClient,
  postId: string,
  userId: string,
  allImages: string[],
): Promise<void> {
  for (const url of allImages) await deleteStorageImage(admin, url)
  if (postId) {
    const { error } = await admin.from("posts").delete().eq("id", postId)
    if (error) console.error("[moderate-image] 删帖失败:", error)
  }
  await notifyUser(admin, userId, MSG_POST_REMOVED)
}

// 剔除违规图(保留正文 + 干净图)+ 删违规图 + 通知作者(用于编辑违规)。
// 重算封面：剩余图的第一张作 image_url；全被剔除则两列都置空。
async function stripImages(
  admin: SupabaseClient,
  postId: string,
  userId: string,
  allImages: string[],
  blocked: Set<string>,
): Promise<void> {
  const remaining = allImages.filter((u) => !blocked.has(u))
  for (const url of blocked) await deleteStorageImage(admin, url)
  if (postId) {
    const { error } = await admin
      .from("posts")
      .update({
        image_url: remaining[0] ?? null,
        image_urls: remaining.length ? remaining : null,
      })
      .eq("id", postId)
    if (error) console.error("[moderate-image] 剔除违规图失败:", error)
  }
  await notifyUser(admin, userId, MSG_IMAGE_REMOVED)
}

// 删存储里的违规图(仅当确属本项目 post-images 桶；路径从 URL 反解，不接受外部任意路径)。
// 主图 + 对应 640px 缩略图一起删：发帖时客户端会同步上传 `<base>_thumb.webp`
// (命名约定见 lib/post-image-thumb.ts，此处为 Deno 环境复制实现)，
// 只删主图会让违规缩略图以公开 URL 残留到每周孤儿清理才消失。
// gif 无缩略图；缩略图不存在时 remove 静默忽略，多删无害。
async function deleteStorageImage(admin: SupabaseClient, imageUrl: string): Promise<void> {
  if (!imageUrl.startsWith(POST_IMAGES_PREFIX)) return
  try {
    const path = decodeURIComponent(imageUrl.slice(POST_IMAGES_PREFIX.length).split("?")[0])
    const targets = [path]
    if (!/\.gif$/i.test(path)) {
      const dot = path.lastIndexOf(".")
      const base = dot > 0 ? path.slice(0, dot) : path
      targets.push(`${base}_thumb.webp`)
    }
    const { error } = await admin.storage.from("post-images").remove(targets)
    if (error) console.error("[moderate-image] 删图失败:", error)
  } catch (e) {
    console.error("[moderate-image] 删图异常:", e)
  }
}

// 给作者写一条 post_removed 通知(post_id 置空，避免被删帖级联带走)。
async function notifyUser(admin: SupabaseClient, userId: string, message: string): Promise<void> {
  if (!userId) return
  const { error } = await admin.from("notifications").insert({
    user_id: userId,
    type: "post_removed",
    post_id: null,
    comment_id: null,
    actor_id: null,
    message,
    is_read: false,
  })
  if (error) console.error("[moderate-image] 写通知失败:", error)
}
