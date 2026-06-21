// Supabase Edge Function: moderate-text
//
// 【先发后审 / 异步文本审核 · 分类分级引擎】由数据库 Webhook 触发：
//   - posts(INSERT/UPDATE)、comments(INSERT/UPDATE)、live_comments(INSERT)
//   - 用 service role 在后台对内容做【归一化 → 白名单豁免 → 词库匹配】；
//   - 命中按该词的 action 分流：
//       block → 删内容 + 通知作者（同旧行为）
//       flag  → 不删，写入 moderation_queue 待管理员人工复核
//   - 未命中 / 无内容 / 词库为空 → 放行（先发后审，用户侧仍是"秒发"）。
//
// 引擎升级点（2026-06-21，配套 scripts/2026-06-21-text-moderation-engine.sql）：
//   1. normalize()：小写化 + 全角转半角 + 去零宽/空格/常见装饰分隔符，
//      对抗 "v★信""微-信""开▲票" 这类分隔规避。词库与白名单都过同一 normalize。
//   2. moderation_allowlist 白名单：命中词若整体落在白名单短语内则豁免，
//      破解 "大约/鞭炮/法律" 被短词 "约/炮/法" 误杀。
//   3. sensitive_words.category + action：按 action 决定"删除"还是"入队待人工"。
//
// 鉴权同 moderate-image：非客户端面向，关闭 JWT，用共享密钥头 x-moderation-secret。
//
// 依赖环境变量（Edge Function Secrets）：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY —— 平台自动注入；
//   MODERATION_WEBHOOK_SECRET —— 与 moderate-image 共用，需与 Webhook 请求头一致。

import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const MODERATION_WEBHOOK_SECRET = Deno.env.get("MODERATION_WEBHOOK_SECRET") ?? ""

// ── 可调策略 ────────────────────────────────────────────────────────────────
// 词库加载失败（表没建/查询异常）时：false=放行降级（默认，避免全站发不出内容）。
const ENFORCE_ON_ERROR = false
// block 命中后是否给作者发"内容被移除"通知。
const NOTIFY_POST = true
const NOTIFY_COMMENT = true
const NOTIFY_DANMU = false
const NOTIFY_CHAT = false
// 词库 / 白名单内存缓存时长：管理员增删后最多这么久全网生效
const CACHE_TTL = 60_000 // 60 秒
// ────────────────────────────────────────────────────────────────────────────

const MSG_POST_REMOVED = "你发布的帖子因包含敏感内容，已被系统自动移除。"
const MSG_COMMENT_REMOVED = "你发表的评论因包含敏感内容，已被系统自动移除。"
const MSG_DANMU_REMOVED = "你发送的弹幕因包含敏感内容，已被移除。"
const MSG_CHAT_REMOVED = "你在聊天室的消息因包含敏感内容，已被移除。"

const POST_IMAGES_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/post-images/`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const str = (v: unknown) => (typeof v === "string" ? v : "")

// ── 归一化 ───────────────────────────────────────────────────────────────────
// 小写化（拼音缩写 xjp/XJP 大小写无关）+ 全角转半角 + 去零宽/空白/常见装饰分隔符。
// 关键：词库和白名单都要过同一个 normalize 再比对，三者口径一致才正确。
function normalize(s: string): string {
  return s
    .toLowerCase()
    // 全角 ASCII（U+FF01–U+FF5E）→ 半角
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    // 零宽字符(U+200B–200D, FEFF) + 全角空格(U+3000) + 一切空白，统统去掉
    .replace(/[​-‍﻿　\s]/g, "")
    // 常见分隔 / 装饰符（让 "v★信""微-信""开▲票" 归一到连续串；全角标点已在上一步转半角）
    .replace(/[-_.*~!?|/\\[\]()<>·•※★☆▲△◆◇●○■□♥♡]/g, "")
}

// ── 词库 + 白名单缓存 ────────────────────────────────────────────────────────
interface WordEntry {
  word: string // 原词（日志/入队展示用）
  norm: string // 归一化后的匹配键
  category: string
  action: "block" | "flag"
}
let wordsCache: { value: WordEntry[]; expireAt: number } | null = null
let allowCache: { value: string[]; expireAt: number } | null = null

async function loadWords(admin: SupabaseClient): Promise<WordEntry[]> {
  const now = Date.now()
  if (wordsCache && wordsCache.expireAt > now) return wordsCache.value

  const { data, error } = await admin
    .from("sensitive_words")
    .select("word, category, action")
    .eq("enabled", true)

  if (error) {
    console.error("[moderate-text] 读取 sensitive_words 失败:", error.message)
    return [] // 不缓存失败；返回空让上层按降级策略放行
  }

  const words: WordEntry[] = []
  for (const r of data ?? []) {
    const norm = normalize(str(r.word))
    if (!norm) continue
    words.push({
      word: str(r.word),
      norm,
      category: str(r.category) || "未分类",
      action: str(r.action) === "flag" ? "flag" : "block",
    })
  }
  wordsCache = { value: words, expireAt: now + CACHE_TTL }
  return words
}

async function loadAllowlist(admin: SupabaseClient): Promise<string[]> {
  const now = Date.now()
  if (allowCache && allowCache.expireAt > now) return allowCache.value

  const { data, error } = await admin
    .from("moderation_allowlist")
    .select("phrase")
    .eq("enabled", true)

  if (error) {
    console.error("[moderate-text] 读取 moderation_allowlist 失败:", error.message)
    // 沿用旧缓存（哪怕过期）：白名单短暂缺失会引发误杀，比放行更该避免
    return allowCache?.value ?? []
  }

  const phrases = (data ?? [])
    .map((r) => normalize(str(r.phrase)))
    .filter((p) => p.length > 0)
  allowCache = { value: phrases, expireAt: now + CACHE_TTL }
  return phrases
}

// 把白名单短语从归一化文本中挖除（替换成占位符，防挖除后两侧字符拼出新命中）。
function maskAllow(normText: string, allow: string[]): string {
  let t = normText
  for (const p of allow) {
    if (p) t = t.split(p).join("")
  }
  return t
}

// 返回所有命中（已扣除白名单）。
function findHits(text: string, words: WordEntry[], allow: string[]): WordEntry[] {
  const norm = maskAllow(normalize(text), allow)
  if (!norm) return []
  const hits: WordEntry[] = []
  for (const w of words) {
    if (norm.includes(w.norm)) hits.push(w)
  }
  return hits
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405)

  // 鉴权：共享密钥头
  const secret = req.headers.get("x-moderation-secret") ?? ""
  if (!MODERATION_WEBHOOK_SECRET || secret !== MODERATION_WEBHOOK_SECRET) {
    return json({ error: "unauthorized" }, 401)
  }

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

  if (eventType !== "INSERT" && eventType !== "UPDATE") return json({ skipped: "ignored event" })
  if (!record) return json({ skipped: "no record" })

  // 按表取出待检文本 + 旧文本（UPDATE 判断是否真的改了）
  let text = ""
  let oldText = ""
  if (table === "posts") {
    text = `${str(record.title)}\n${str(record.content)}`
    oldText = `${str(oldRecord?.title)}\n${str(oldRecord?.content)}`
  } else if (table === "comments" || table === "live_comments" || table === "chat_messages") {
    text = str(record.content)
    oldText = str(oldRecord?.content)
  } else {
    return json({ skipped: `unhandled table: ${table}` })
  }

  if (eventType === "UPDATE" && text === oldText) return json({ skipped: "text unchanged" })
  if (!text.trim()) return json({ skipped: "empty text" })

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const [words, allow] = await Promise.all([loadWords(admin), loadAllowlist(admin)])
  if (words.length === 0) {
    // 词库为空/加载失败：按降级策略，默认放行
    return json({ degraded: true, reason: "no words" })
  }

  const hits = findHits(text, words, allow)
  if (hits.length === 0) {
    // 改干净了：撤销该内容之前可能留下的待审队列项
    if (eventType === "UPDATE") {
      await admin
        .from("moderation_queue")
        .delete()
        .eq("table_name", table)
        .eq("record_id", str(record.id))
        .eq("status", "pending")
    }
    return json({ allowed: true })
  }

  // block 优先于 flag：只要有任一 block 命中即删除；否则取首个 flag 入队。
  const target = hits.find((h) => h.action === "block") ?? hits[0]

  if (target.action === "block") {
    console.log("[moderate-text] block 命中", {
      table, id: str(record.id), category: target.category, word: target.word,
    })
    await enforceRemove(admin, table, record)
    return json({ removed: table, id: str(record.id), category: target.category })
  }

  // flag：不删，入队待人工
  console.log("[moderate-text] flag 入队", {
    table, id: str(record.id), category: target.category, word: target.word,
  })
  await enqueue(admin, table, record, text, target)
  return json({ flagged: table, id: str(record.id), category: target.category })
})

// flag：写入审核队列（按 table_name+record_id 去重 upsert；UPDATE 重判时刷新快照）。
async function enqueue(
  admin: SupabaseClient,
  table: string,
  record: Record<string, unknown>,
  text: string,
  hit: WordEntry,
): Promise<void> {
  const { error } = await admin.from("moderation_queue").upsert(
    {
      table_name: table,
      record_id: str(record.id),
      user_id: str(record.user_id) || null,
      content: text.slice(0, 2000),
      category: hit.category,
      matched: hit.word,
      source: "keyword",
      status: "pending",
    },
    { onConflict: "table_name,record_id" },
  )
  if (error) console.error("[moderate-text] 入队失败:", error)
}

// block：按表执行移除（保留原逻辑）。
async function enforceRemove(
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
  } else if (table === "chat_messages") {
    await removeChat(admin, id, userId)
  }
}

// 删整帖：先删子内容（评论/点赞）再删帖本体；有图则顺带删存储图；最后通知作者。
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

// 删单条评论 + 它的点赞。
async function removeComment(admin: SupabaseClient, commentId: string, userId: string): Promise<void> {
  if (!commentId) return
  await admin.from("comment_likes").delete().eq("comment_id", commentId)
  const { error } = await admin.from("comments").delete().eq("id", commentId)
  if (error) console.error("[moderate-text] 删评论失败:", error)
  if (NOTIFY_COMMENT) await notifyUser(admin, userId, MSG_COMMENT_REMOVED)
}

// 删单条弹幕。默认不通知（NOTIFY_DANMU=false）。
async function removeDanmu(admin: SupabaseClient, id: string, userId: string): Promise<void> {
  if (!id) return
  const { error } = await admin.from("live_comments").delete().eq("id", id)
  if (error) console.error("[moderate-text] 删弹幕失败:", error)
  if (NOTIFY_DANMU) await notifyUser(admin, userId, MSG_DANMU_REMOVED)
}

// 删大厅聊天消息。默认不通知（与弹幕一致：量大、转瞬即逝）。
async function removeChat(admin: SupabaseClient, id: string, userId: string): Promise<void> {
  if (!id) return
  const { error } = await admin.from("chat_messages").delete().eq("id", id)
  if (error) console.error("[moderate-text] 删聊天消息失败:", error)
  if (NOTIFY_CHAT) await notifyUser(admin, userId, MSG_CHAT_REMOVED)
}

// 删存储里的图（仅当确属本项目 post-images 桶；路径从 URL 反解，不接受外部任意路径）。
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

// 给作者写一条 post_removed 通知（post_id/comment_id 置空，避免被级联删除带走）。
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
