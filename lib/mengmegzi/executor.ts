// lib/mengmegzi/executor.ts
//
// 执行内核：发帖/留言/回复三个函数 + 轮询目标筛选。
// 每个执行函数失败抛错（由 tick catch 后 markDead），图片相关失败内部降级不抛。
// 调用前调用方应已 markBusy，调用后调用方 markIdle/markDead。

import { createClient } from "@supabase/supabase-js"
import { loadDmAiConfig } from "@/lib/hanako/dm-ai"
import {
  MENGMEGZI_USER_ID,
  ALL_CATEGORIES,
  POST_TEMPERATURE,
  COMMENT_TEMPERATURE,
  MAX_AGENT_TOKENS,
} from "./constants"
import {
  buildPostSystemPrompt,
  buildPostUserMessage,
  buildCommentSystemPrompt,
  buildCommentUserMessage,
  buildReplySystemPrompt,
  buildReplyUserMessage,
  type TargetPost,
} from "./prompts"
import { callAiForJson } from "./ai-client"
import { fetchImageForCategory, type ImageSourceConfig } from "./image-sources"
import { downloadCompressUpload } from "./image-pipeline"
import { loadConfig, logAction } from "./state"
import type { CategoryValue } from "@/lib/categories"
import { isValidCategory } from "@/lib/categories"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** 随机选一个分类（保证 6 类均匀分布） */
function pickRandomCategory(): CategoryValue {
  const idx = Math.floor(Math.random() * ALL_CATEGORIES.length)
  return ALL_CATEGORIES[idx] as CategoryValue
}

interface PostGen {
  title: string
  content: string
  description: string
}

/**
 * 发帖：AI 生成文字 → 按分类配图 → 写 posts 表。
 * 图片相关失败降级纯文字帖，不抛错；AI/写库失败抛错。
 * @param forcedCategory 代码指定的分类（不传则随机选）
 * @returns 新帖 id
 */
export async function executePost(forcedCategory?: CategoryValue): Promise<string> {
  const cfg = await loadDmAiConfig()
  const agentCfg = await loadConfig()
  const category =
    forcedCategory && isValidCategory(forcedCategory) ? forcedCategory : pickRandomCategory()

  // 1. AI 生成文字
  const messages = [
    { role: "system" as const, content: buildPostSystemPrompt(cfg.persona) },
    { role: "user" as const, content: buildPostUserMessage(category) },
  ]
  const gen = (await callAiForJson(cfg, messages, POST_TEMPERATURE, MAX_AGENT_TOKENS)) as PostGen
  if (!gen?.title || !gen?.content) {
    throw new Error("AI 输出缺 title/content")
  }

  // 2. 配图（失败降级纯文字，不抛错）
  let imageUrl: string | null = null
  let imageRatio: number | null = null
  const srcCfg = (agentCfg?.image_sources?.[category] as ImageSourceConfig) || { provider: "none" }
  const img = await fetchImageForCategory(category, srcCfg)
  if (img) {
    // 用临时 uuid 作 Storage 路径（post_id 此时还没生成）
    const tempId = crypto.randomUUID()
    const processed = await downloadCompressUpload(img.url, tempId)
    if (processed) {
      imageUrl = processed.publicUrl
      imageRatio = processed.ratio
    }
  }

  // 3. 写 posts 表
  const { data, error } = await supabaseAdmin
    .from("posts")
    .insert([
      {
        title: gen.title,
        content: gen.content,
        description: gen.description || "",
        category,
        image_url: imageUrl,
        image_urls: imageUrl ? [imageUrl] : null,
        image_ratio: imageRatio,
        user_id: MENGMEGZI_USER_ID,
        likes: 0,
        comments: 0,
      },
    ])
    .select("id")
    .single()
  if (error) throw new Error(`写 posts 失败: ${error.message}`)

  await logAction("post", null, "success", data.id)
  return data.id
}

/**
 * 留言：读目标帖 → AI 生成评论 → 写 comments 表。
 * 帖子不存在/AI 失败/写库失败抛错。
 * @returns 新评论 id
 */
export async function executeComment(postId: string): Promise<string> {
  const cfg = await loadDmAiConfig()
  const { data: post, error: pErr } = await supabaseAdmin
    .from("posts")
    .select("id, title, content, category")
    .eq("id", postId)
    .maybeSingle()
  if (pErr || !post) throw new Error(`帖子 ${postId} 不存在`)

  const target: TargetPost = post
  const messages = [
    { role: "system" as const, content: buildCommentSystemPrompt(cfg.persona) },
    { role: "user" as const, content: buildCommentUserMessage(target) },
  ]
  const gen = (await callAiForJson(cfg, messages, COMMENT_TEMPERATURE, MAX_AGENT_TOKENS)) as {
    content: string
  }
  if (!gen?.content) throw new Error("AI 输出缺 content")

  const { data, error } = await supabaseAdmin
    .from("comments")
    .insert([
      {
        post_id: postId,
        user_id: MENGMEGZI_USER_ID,
        content: gen.content,
      },
    ])
    .select("id")
    .single()
  if (error) throw new Error(`写 comments 失败: ${error.message}`)

  await logAction("comment", postId, "success", data.id)
  return data.id
}

/**
 * 回复：读被回复的评论 + 其所属帖 → AI 生成回复 → 写 comments（带 parent_id）。
 * @returns 新回复 id
 */
export async function executeReply(commentId: string): Promise<string> {
  const cfg = await loadDmAiConfig()
  const { data: comment, error: cErr } = await supabaseAdmin
    .from("comments")
    .select("id, content, post_id")
    .eq("id", commentId)
    .maybeSingle()
  if (cErr || !comment) throw new Error(`评论 ${commentId} 不存在`)

  const { data: post, error: pErr } = await supabaseAdmin
    .from("posts")
    .select("id, title, content, category")
    .eq("id", comment.post_id)
    .maybeSingle()
  if (pErr || !post) throw new Error(`帖子 ${comment.post_id} 不存在`)

  const target: TargetPost = post
  const messages = [
    { role: "system" as const, content: buildReplySystemPrompt(cfg.persona) },
    {
      role: "user" as const,
      content: buildReplyUserMessage(target, { content: comment.content }),
    },
  ]
  const gen = (await callAiForJson(cfg, messages, COMMENT_TEMPERATURE, MAX_AGENT_TOKENS)) as {
    content: string
  }
  if (!gen?.content) throw new Error("AI 输出缺 content")

  const { data, error } = await supabaseAdmin
    .from("comments")
    .insert([
      {
        post_id: comment.post_id,
        user_id: MENGMEGZI_USER_ID,
        content: gen.content,
        parent_id: commentId,
      },
    ])
    .select("id")
    .single()
  if (error) throw new Error(`写 comments 失败: ${error.message}`)

  await logAction("reply", commentId, "success", data.id)
  return data.id
}

// ── 轮询目标筛选（tick 用） ──

/**
 * 找一个可留言的新帖：最近 scanHours 内、非萌萌子自己发的、未成功留言过。
 * 没有候选返回 null。
 */
export async function findCommentablePost(scanHours: number): Promise<string | null> {
  const since = new Date(Date.now() - scanHours * 3600 * 1000).toISOString()

  // 查已成功留言过的帖子 id（跳过防重复）
  const { data: done } = await supabaseAdmin
    .from("mengmegzi_action_log")
    .select("target_id")
    .eq("action_type", "comment")
    .eq("result", "success")
  const doneIds = new Set((done || []).map((r: any) => r.target_id))

  const { data: posts } = await supabaseAdmin
    .from("posts")
    .select("id")
    .gt("created_at", since)
    .neq("user_id", MENGMEGZI_USER_ID)
    .order("created_at", { ascending: false })
    .limit(200)

  const candidates = (posts || []).filter((p: any) => !doneIds.has(p.id))
  if (candidates.length === 0) return null
  const pick = candidates[Math.floor(Math.random() * candidates.length)]
  return pick.id
}

/**
 * 找一个待回复的评论：在萌萌子帖下、非萌萌子发的、没回复过。
 * 没有候选返回 null。
 */
export async function findReplyableComment(): Promise<string | null> {
  // 萌萌子的帖 id 集合
  const { data: myPosts } = await supabaseAdmin
    .from("posts")
    .select("id")
    .eq("user_id", MENGMEGZI_USER_ID)
  const myPostIds = (myPosts || []).map((p: any) => p.id)
  if (myPostIds.length === 0) return null

  // 已回复过的评论 id
  const { data: done } = await supabaseAdmin
    .from("mengmegzi_action_log")
    .select("target_id")
    .eq("action_type", "reply")
    .eq("result", "success")
  const doneIds = new Set((done || []).map((r: any) => r.target_id))

  const { data: comments } = await supabaseAdmin
    .from("comments")
    .select("id")
    .in("post_id", myPostIds)
    .neq("user_id", MENGMEGZI_USER_ID)
    .order("created_at", { ascending: true })
    .limit(200)

  const candidates = (comments || []).filter((c: any) => !doneIds.has(c.id))
  if (candidates.length === 0) return null
  return candidates[0].id
}
