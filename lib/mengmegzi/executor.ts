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
  /** AI 顺手吐的英文配图关键词（可选；空/搜不到则回退分类固定词） */
  image_query?: string
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

  // 2. 配图（失败降级纯文字，不抛错）。imgLog 记录配图详情，写进行动日志供面板观察。
  let imageUrl: string | null = null
  let imageRatio: number | null = null
  let imgLog = ""
  const srcCfg = (agentCfg?.image_sources?.[category] as ImageSourceConfig) || { provider: "none" }
  const aiQ = gen.image_query || ""
  if (srcCfg.provider === "none") {
    imgLog = `无配图(${category}=none)`
  } else {
    // AI 顺手吐的 image_query 优先（贴合正文、每帖不同），搜不到回退分类固定词
    const img = await fetchImageForCategory(srcCfg, aiQ)
    if (img) {
      // 用临时 uuid 作 Storage 文件名（post_id 此时还没生成）
      const fileId = crypto.randomUUID()
      const processed = await downloadCompressUpload(img, fileId)
      if (processed) {
        imageUrl = processed.publicUrl
        imageRatio = processed.ratio
        imgLog =
          `配图✓ ${img.source}「${img.query || "?"}」` +
          (img.viaFallback ? `(回退·AI词「${aiQ}」没命中)` : "(AI词命中)") +
          (img.score != null ? ` score=${img.score}` : "") +
          (img.rating ? ` rating=${img.rating}` : "")
      } else {
        imgLog = "配图✗ 下载/上传失败→纯文字"
      }
    } else {
      imgLog = `配图✗ AI词「${aiQ}」+回退「${srcCfg.query || ""}」都搜不到→纯文字`
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

  await logAction("post", null, "success", `${data.id} | ${imgLog}`)
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

  // 先取最近 scanHours 内、非萌萌子自己的帖
  const { data: posts } = await supabaseAdmin
    .from("posts")
    .select("id")
    .gt("created_at", since)
    .neq("user_id", MENGMEGZI_USER_ID)
    .order("created_at", { ascending: false })
    .limit(200)
  const ids = (posts || []).map((p: any) => p.id)
  if (ids.length === 0) return null

  // 只在这批候选帖里查「已成功留言过的」（查询有界：随窗口帖数、不随全历史日志增长）
  const { data: done } = await supabaseAdmin
    .from("mengmegzi_action_log")
    .select("target_id")
    .eq("action_type", "comment")
    .eq("result", "success")
    .in("target_id", ids)
  const doneIds = new Set((done || []).map((r: any) => r.target_id))

  const candidates = ids.filter((id: string) => !doneIds.has(id))
  if (candidates.length === 0) return null
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/**
 * 找一个待回复的评论：在萌萌子帖下、非萌萌子发的、没回复过。
 * 没有候选返回 null。
 */
export async function findReplyableComment(): Promise<string | null> {
  // 萌萌子最近 200 帖（避免随历史发帖量无界增长 + .in() 数组过大）
  const { data: myPosts } = await supabaseAdmin
    .from("posts")
    .select("id")
    .eq("user_id", MENGMEGZI_USER_ID)
    .order("created_at", { ascending: false })
    .limit(200)
  const myPostIds = (myPosts || []).map((p: any) => p.id)
  if (myPostIds.length === 0) return null

  // 这些帖下、非萌萌子发的评论（最早优先）
  const { data: comments } = await supabaseAdmin
    .from("comments")
    .select("id")
    .in("post_id", myPostIds)
    .neq("user_id", MENGMEGZI_USER_ID)
    .order("created_at", { ascending: true })
    .limit(200)
  const commentIds = (comments || []).map((c: any) => c.id)
  if (commentIds.length === 0) return null

  // 只在这批候选评论里查「已回复过的」（查询有界）
  const { data: done } = await supabaseAdmin
    .from("mengmegzi_action_log")
    .select("target_id")
    .eq("action_type", "reply")
    .eq("result", "success")
    .in("target_id", commentIds)
  const doneIds = new Set((done || []).map((r: any) => r.target_id))

  const target = commentIds.find((id: string) => !doneIds.has(id))
  return target || null
}
