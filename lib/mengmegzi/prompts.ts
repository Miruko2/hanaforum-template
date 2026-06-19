// lib/mengmegzi/prompts.ts
//
// 3 套 prompt：发帖/留言/回复。
// 人格段统一用 dm_ai_config.persona 原文，任务段不含任何性格描述。
// 严格 JSON 输出。分类由代码指定（注入 user 消息），AI 只生成 title/content/description。

import { CATEGORY_LABELS } from "@/lib/categories"
import type { CategoryValue } from "@/lib/categories"

export interface TargetPost {
  id: string
  title: string
  content: string
  category: string
}

/** 发帖 system prompt（分类由代码指定，注入 user 消息） */
export function buildPostSystemPrompt(persona: string): string {
  return `${persona}

你现在要像普通用户一样发一个新帖子。

输出严格 JSON，不要任何多余文字：
{"title": "<标题，10~30字>", "content": "<正文，50~300字>", "description": "<一句话摘要，20字内>", "image_query": "<英文配图关键词>"}

image_query 会拿去二次元图站按 tag 搜图，请遵守：
- 用具体、能画出来的名词（物体/场景/角色特征），别用抽象概念
- 单数、小写；复合词用下划线连接
- 好例子：cat、guitar、cityscape、cherry_blossoms、school_uniform、ocean、night_sky
- 坏例子：happy_moment、daily_life、good_vibes（这类抽象词搜不到，会退回默认图）
- 实在想不到就给空字符串

禁止：代码块包裹、JSON 前后加说明、content 为空。`
}

/** 发帖 user 消息（注入代码随机指定的分类） */
export function buildPostUserMessage(category: CategoryValue): string {
  return `发一个 ${CATEGORY_LABELS[category] || category} 分类的帖子。`
}

/** 留言 system prompt */
export function buildCommentSystemPrompt(persona: string): string {
  return `${persona}

你要在别人的帖子下面留一条评论。

输出严格 JSON：
{"content": "<评论内容，10~80字>"}

禁止：代码块包裹、多余说明、content 为空。`
}

/** 留言 user 消息（注入目标帖子） */
export function buildCommentUserMessage(post: TargetPost): string {
  return `帖子标题：${post.title}
帖子分类：${CATEGORY_LABELS[post.category] || post.category}
帖子正文：
${post.content}

请留一条评论：`
}

/** 回复 system prompt */
export function buildReplySystemPrompt(persona: string): string {
  return `${persona}

有人在你（或你回复过）的内容下评论了，你要回复他。

输出严格 JSON：
{"content": "<回复内容，10~80字>"}

禁止：代码块包裹、多余说明、content 为空。`
}

/** 回复 user 消息（注入原帖 + 对方评论） */
export function buildReplyUserMessage(post: TargetPost, comment: { content: string }): string {
  return `【原帖标题】${post.title}
【原帖正文】${post.content}

【对方的评论】${comment.content}

请回复他：`
}
