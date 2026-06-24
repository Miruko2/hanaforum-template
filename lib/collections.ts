// lib/collections.ts
// 论坛「收藏」功能的客户端数据层 + 一个模块级单点 store。
//
// 为什么要 store：主信息流是窗口化虚拟列表（react-window），滚出视口的卡片会被卸载。
// 若「已收藏」只存在卡片本地 state，滚出去再滚回来就会丢。所以用一个进程内单例 Set
// 作为「当前用户收藏了哪些帖」的唯一真相，配合订阅让已挂载的卡片即时刷新。
//
// 隐私：collections 表是私密的（RLS：仅本人可读写），所以这里只关心「我」的收藏，
// 永远数不到、也不展示别人的收藏数 —— 收藏按钮因此是个纯开关，不带数字。

import { supabase } from "./supabaseClient"
import type { Post } from "./types"

// 当前用户已收藏的 post_id 集合（同步可读，供 UI 即时取用）
const collectedIds = new Set<string>()
// 已为哪个 userId 完成过一次性加载；切换账号时重置
let loadedForUser: string | null = null
// 防并发：同一时刻只发一次「加载我的收藏」查询
let loadingPromise: Promise<void> | null = null

const listeners = new Set<() => void>()
function emit() {
  listeners.forEach((l) => {
    try {
      l()
    } catch {
      // 单个订阅者抛错不影响其余
    }
  })
}

/** 订阅收藏集合变化（卡片挂载时调用，返回取消订阅函数）。 */
export function subscribeCollections(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** 同步判断某帖当前是否已被「我」收藏。 */
export function isPostCollected(postId: string): boolean {
  return collectedIds.has(postId)
}

/** 当前已知的收藏总数（仅在已加载后准确）。 */
export function collectedCount(): number {
  return collectedIds.size
}

/**
 * 一次性加载「我的收藏」到 store（幂等：同一用户只真正查一次）。
 * 卡片挂载时调用即可，无需在列表层手动触发。
 */
export async function loadMyCollections(userId: string): Promise<void> {
  if (!userId) return
  if (loadedForUser === userId) return
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from("collections")
        .select("post_id")
        .eq("user_id", userId)

      if (error) {
        console.error("加载我的收藏失败:", error)
        return
      }

      collectedIds.clear()
      for (const row of data || []) {
        if (row.post_id) collectedIds.add(row.post_id as string)
      }
      loadedForUser = userId
      emit()
    } finally {
      loadingPromise = null
    }
  })()

  return loadingPromise
}

/** 退出登录 / 切换账号时清空 store。 */
export function resetCollectionsStore(): void {
  collectedIds.clear()
  loadedForUser = null
  emit()
}

/**
 * 收藏一个帖子。乐观更新 store（立即 emit），失败回滚。
 * 仅在「当前未收藏」时调用；重复插入命中唯一索引会被当作幂等成功处理。
 */
export async function collectPost(postId: string, userId: string): Promise<void> {
  if (collectedIds.has(postId)) return
  collectedIds.add(postId)
  emit()

  const { error } = await supabase
    .from("collections")
    .insert([{ post_id: postId, user_id: userId, created_at: new Date().toISOString() }])

  // 23505 = 唯一索引冲突（已收藏过）：视为幂等成功，保留已收藏态
  if (error && (error as { code?: string }).code !== "23505") {
    collectedIds.delete(postId)
    emit()
    throw error
  }
}

/**
 * 取消收藏。乐观更新 store（立即 emit），失败回滚。
 */
export async function uncollectPost(postId: string, userId: string): Promise<void> {
  if (!collectedIds.has(postId)) return
  collectedIds.delete(postId)
  emit()

  const { error } = await supabase
    .from("collections")
    .delete()
    .eq("post_id", postId)
    .eq("user_id", userId)

  if (error) {
    collectedIds.add(postId)
    emit()
    throw error
  }
}

/**
 * 列出「我的收藏」帖子，按收藏时间倒序（最近收藏在前）。
 * 借助 post_id 外键，PostgREST 一条查询直接带出帖子；帖子被删的孤儿行已被级联清理。
 * 供收藏夹展示页（集邮册）使用。
 */
export async function getMyCollections(userId: string): Promise<Post[]> {
  if (!userId) return []

  const { data, error } = await supabase
    .from("collections")
    .select("created_at, post:posts(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })

  if (error) {
    console.error("获取收藏列表失败:", error)
    return []
  }

  // 同步 store（顺带把收藏夹页的查询结果灌进单点 store，保持一致）
  // 经 post_id 外键嵌入的 posts 是「多对一」，运行时返回单个对象；
  // 但无生成式 DB 类型时 PostgREST 把它推断成数组，故先经 unknown 再断言成单对象。
  collectedIds.clear()
  const posts: Post[] = []
  for (const row of (data || []) as unknown as Array<{ post: Post | null }>) {
    if (row.post && row.post.id) {
      collectedIds.add(row.post.id)
      posts.push(row.post)
    }
  }
  loadedForUser = userId
  emit()

  if (posts.length === 0) return posts

  // 富集作者用户名/头像 + 点赞/评论数。
  // posts 表本身没有 username 列（全站靠 join profiles），点赞数据库列也不可靠
  // （全站口径都是从 likes/comments 表实时计数）。不富集的话票券/详情里
  // 用户名会落到「用户」、点赞恒为 0。
  const postIds = posts.map((p) => p.id)
  const userIds = [...new Set(posts.map((p) => p.user_id).filter(Boolean))]

  const nameMap = new Map<string, string>()
  const avatarMap = new Map<string, string | null>()
  const likesMap = new Map<string, number>()
  const commentsMap = new Map<string, number>()

  await Promise.all([
    // 作者用户名/头像（profiles 批量；邮箱格式只取 @ 前缀，与全站显示口径一致）
    supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", userIds)
      .then(({ data: rows }) => {
        for (const p of (rows as Array<{ id: string; username?: string; avatar_url?: string | null }>) || []) {
          const raw = p.username || ""
          const name = raw.includes("@") ? raw.split("@")[0] : raw
          if (name) nameMap.set(p.id, name)
          avatarMap.set(p.id, p.avatar_url ?? null)
        }
      }),
    // 逐帖点赞数（head 计数：只回数字、不传行，低 egress）
    ...postIds.map((id) =>
      supabase
        .from("likes")
        .select("*", { count: "exact", head: true })
        .eq("post_id", id)
        .then(({ count }) => {
          likesMap.set(id, count || 0)
        }),
    ),
    // 逐帖评论数
    ...postIds.map((id) =>
      supabase
        .from("comments")
        .select("*", { count: "exact", head: true })
        .eq("post_id", id)
        .then(({ count }) => {
          commentsMap.set(id, count || 0)
        }),
    ),
  ])

  // 与全站 post 结构对齐：username + users{} + likes_count/comments_count
  for (const p of posts) {
    const name = nameMap.get(p.user_id) || `用户_${(p.user_id || "").substring(0, 6)}`
    p.username = name
    p.users = { id: p.user_id, username: name, avatar_url: avatarMap.get(p.user_id) ?? undefined }
    p.likes_count = likesMap.get(p.id) ?? 0
    p.comments_count = commentsMap.get(p.id) ?? 0
  }

  return posts
}
