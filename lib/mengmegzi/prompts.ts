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

/**
 * 每个分类的发帖内容指引：让「正文」和「image_query」都贴着分类走。
 * 没有指引时，AI 常把色图帖写成学习/数学等跑题内容、image_query 也跟着跑题搜不到图
 * → 回退默认图 → 出现「配文聊数学、配图却是泳装」的精分组合。
 */
const CATEGORY_POST_BRIEF: Record<string, string> = {
  general: "像普通网友发条日常杂谈——心情、生活小事、吐槽、有趣见闻、随想都行，话题随意、别都聊动漫。image_query 用图里能画出来的具体名词，配一张好看的图点缀即可。",
  nsfw: "你在分享一张性感可爱的二次元美图（不露点的软色情福利图）。配文要围绕「这张图本身」——颜值、身材、服装、害羞心动那种感觉，像个爱发福利图的群友。image_query 必须是能搜到性感图的英文 booru tag，例如 swimsuit、bikini、thighhighs、school_swimsuit、leotard、maid、bunny_girl、cleavage、garter_belt。绝对别写学习、数学、文具、工作之类跟性感图无关的话题。",
  game: "聊一款游戏或某个游戏角色/场景，配一张相关动漫图。image_query 用游戏/角色相关的 tag。",
  code: "聊点编程/技术话题或踩坑心得（这个分类不配图）。",
  life: "聊生活日常——风景、美食、心情小事，配一张应景的图。image_query 用 scenery、food、cafe 之类。",
  help: "像在向大家求助提问，描述你遇到的问题（这个分类不配图）。",
}

/** 发帖 user 消息（注入代码随机指定的分类 + 该分类的内容指引） */
export function buildPostUserMessage(category: CategoryValue): string {
  const label = CATEGORY_LABELS[category] || category
  const brief = CATEGORY_POST_BRIEF[category]
  return `发一个「${label}」分类的帖子。${brief ? `\n${brief}` : ""}`
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
