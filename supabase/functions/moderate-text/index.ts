// Supabase Edge Function: moderate-text
//
// 【先发后审 / 异步文本审核】由数据库 Webhook 触发：
//   - posts(INSERT/UPDATE)、comments(INSERT/UPDATE)、live_comments(INSERT)
//   - 用 service role 在后台把内容比对 sensitive_words 词库(目前只装政治类)；
//   - 命中 → 删内容 + 通知作者(post_removed 通知，复用现有类型)；
//   - 未命中 / 无内容 / 词库为空 → 什么都不做。
// 用户发帖/评论/弹幕都是"秒发"，审核在后台跑(代价：违规内容会短暂可见几秒再被撤下)。
//
// 鉴权同 moderate-image：本函数是 Webhook 后台目标、不面向客户端，因此
//   - 关闭 JWT 校验(verify_jwt = false)；
//   - 用共享密钥头 x-moderation-secret 鉴权，复用 moderate-image 的同一个密钥。
//
// 依赖的环境变量(Edge Function Secrets)：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY —— Supabase 自动注入；
//   MODERATION_WEBHOOK_SECRET —— 与 moderate-image 共用，需与 Webhook 里设置的同名请求头一致。

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const MODERATION_WEBHOOK_SECRET = Deno.env.get("MODERATION_WEBHOOK_SECRET") ?? ""

// ── 可调策略 ────────────────────────────────────────────────────────────────
// 词库加载失败(表没建/查询异常)时的策略：
//   false = 放行(降级，不误删正常内容 —— 默认)；true = 当作未配置直接放行同此。
//   注：文本审核没有"宁可错杀"的必要，词库挂了就放行，避免全站发不出内容。
const ENFORCE_ON_ERROR = false
// 命中后是否给作者发"内容被移除"通知。弹幕量大且转瞬即逝，默认不打扰；帖子/评论默认通知。
const NOTIFY_POST = true
const NOTIFY_COMMENT = true
const NOTIFY_DANMU = false
// 词库内存缓存时长：管理员增删词后最多这么久全网生效
const WORDS_CACHE_TTL = 60_000 // 60 秒
// ────────────────────────────────────────────────────────────────────────────

const MSG_POST_REMOVED = "你发布的帖子因包含敏感内容，已被系统自动移除。"
const MSG_COMMENT_REMOVED = "你发表的评论因包含敏感内容，已被系统自动移除。"
const MSG_DANMU_REMOVED = "你发送的弹幕因包含敏感内容，已被移除。"

// post-images 公开桶 URL 前缀，删整帖时顺带删图，避免存储里留孤儿图。
const POST_IMAGES_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/post-images/`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })

const str = (v: unknown) => (typeof v === "string" ? v : "")

// ── 词库缓存 ─────────────────────────────────────────────────────────────────
let wordsCache: { value: string[]; expireAt: number } | null = null

async function loadWords(admin: SupabaseClient): Promise<string[]> {
  const now = Date.now()
  if (wordsCache && wordsCache.expireAt > now) return wordsCache.value

  const { data, error } = await admin
    .from("sensitive_words")
    .select("word")
    .eq("enabled", true)

  if (error) {
    console.error("[moderate-text] 读取 sensitive_words 失败:", error.message)
    // 不缓存失败结果，下次重试；返回空数组让上层按降级策略放行
    return []
  }

  const words = (data ?? [])
    .map((r) => str(r.word).trim().toLowerCase())
    .filter((w) => w.length > 0)

  wordsCache = { value: words, expireAt: now + WORDS_CACHE_TTL }
  return words
}

// 命中检测：把待检文本小写化后做子串匹配(中文无词边界，子串即可；
// 小写化是为了让 xjp / XJP 这类拼音缩写大小写无关)。命中返回该词，否则返回 null。
function findHit(text: string, words: string[]): string | null {
  const hay = text.toLowerCase()
  for (const w of words) {
    if (hay.includes(w)) return w
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  // 鉴权：共享密钥头
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
  const table = str(payload?.table)
  const record = (payload?.record ?? null) as Record<string, unknown> | null
  const oldRecord = (payload?.old_record ?? null) as Record<string, unknown> | null

  if (eventType !== "INSERT" && eventType !== "UPDATE") {
    return json({ skipped: "ignored event" })
  }
  if (!record) return json({ skipped: "no record" })

  // 按表取出要检测的文本 + 旧文本(UPDATE 时用于判断是否真的改了)
  let text = ""
  let oldText = ""
  if (table === "posts") {
    text = `${str(record.title)}\n${str(record.content)}`
    oldText = `${str(oldRecord?.title)}\n${str(oldRecord?.content)}`
  } else if (table === "comments") {
    text = str(record.content)
    oldText = str(oldRecord?.content)
  } else if (table === "live_comments") {
    text = str(record.content)
    oldText = str(oldRecord?.content)
  } else {
    return json({ skipped: `unhandled table: ${table}` })
  }

  // UPDATE 但文本没变：跳过(避免点赞/计数等无关更新、以及本函数操作引发的重复审核)
  if (eventType === "UPDATE" && text === oldText) {
    return json({ skipped: "text unchanged" })
  }
  if (!text.trim()) return json({ skipped: "empty text" })

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const words = await loadWords(admin)
  if (words.length === 0) {
    // 词库为空/加载失败：按降级策略，默认放行
    if (!ENFORCE_ON_ERROR) return json({ degraded: true, reason: "no words" })
    return json({ degraded: true, reason: "no words" })
  }

  const hit = findHit(text, words)
  if (!hit) return json({ allowed: true })

  // 命中：移除内容 + 通知。命中词只打到函数日志，不写进响应体。
  console.log("[moderate-text] 命中敏感词", { table, id: str(record.id), word: hit })
  await enforce(admin, table, record)
  return json({ removed: table, id: str(record.id) })
})

// 按表执行移除
async function enforce(
  admin: SupabaseClient,
  table: string,
  record: Record<string, unknown>,
): Promise<void> {
  const id = str(record.id)
  const userId = str(record.user_id)
  if (table === "posts") {
    await removePost(admin, id, userId, str(record.image_url))
  } else if (table === "comments") {
    await removeComment(admin, id, userId)
  } else if (table === "live_comments") {
    await removeDanmu(admin, id, userId)
  }
}

// 删整帖：先删子内容(评论/点赞)再删帖本体，避免外键无级联时报错；
// 有图则顺带删存储图。最后通知作者。
async function removePost(
  admin: SupabaseClient,
  postId: string,
  userId: string,
  imageUrl: string,
): Promise<void> {
  if (!postId) return
  if (imageUrl) await deleteStorageImage(admin, imageUrl)
  await admin.from("comments").delete().eq("post_id", postId)
  await admin.from("likes").delete().eq("post_id", postId)
  const { error } = await admin.from("posts").delete().eq("id", postId)
  if (error) console.error("[moderate-text] 删帖失败:", error)
  if (NOTIFY_POST) await notifyUser(admin, userId, MSG_POST_REMOVED)
}

// 删单条评论 + 它的点赞。子回复会被 getComments 提升为根评论(可接受的边界情况，
// 敏感评论又恰好有子回复的概率很低；如需连子树一起删可后续再加递归)。
async function removeComment(
  admin: SupabaseClient,
  commentId: string,
  userId: string,
): Promise<void> {
  if (!commentId) return
  await admin.from("comment_likes").delete().eq("comment_id", commentId)
  const { error } = await admin.from("comments").delete().eq("id", commentId)
  if (error) console.error("[moderate-text] 删评论失败:", error)
  if (NOTIFY_COMMENT) await notifyUser(admin, userId, MSG_COMMENT_REMOVED)
}

// 删单条弹幕。默认不通知(NOTIFY_DANMU=false)。
async function removeDanmu(
  admin: SupabaseClient,
  id: string,
  userId: string,
): Promise<void> {
  if (!id) return
  const { error } = await admin.from("live_comments").delete().eq("id", id)
  if (error) console.error("[moderate-text] 删弹幕失败:", error)
  if (NOTIFY_DANMU) await notifyUser(admin, userId, MSG_DANMU_REMOVED)
}

// 删存储里的图(仅当确属本项目 post-images 桶；路径从 URL 反解，不接受外部任意路径)。
async function deleteStorageImage(admin: SupabaseClient, imageUrl: string): Promise<void> {
  if (!imageUrl.startsWith(POST_IMAGES_PREFIX)) return
  try {
    const path = decodeURIComponent(imageUrl.slice(POST_IMAGES_PREFIX.length).split("?")[0])
    const { error } = await admin.storage.from("post-images").remove([path])
    if (error) console.error("[moderate-text] 删图失败:", error)
  } catch (e) {
    console.error("[moderate-text] 删图异常:", e)
  }
}

// 给作者写一条 post_removed 通知(post_id/comment_id 置空，避免被级联删除带走)。
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
  if (error) console.error("[moderate-text] 写通知失败:", error)
}
