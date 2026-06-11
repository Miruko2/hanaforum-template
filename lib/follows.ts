// lib/follows.ts
//
// 关注关系数据层（统一收口 follows 表的读写）。服务于社交个人页 /user：
// 判断「我是否已关注 Ta」、关注 / 取关、统计粉丝数与关注数。
//
// 设计：不维护计数列，按需 count(*)（follows 量级小且两向都有索引）。
// 关注成功后顺带发一条 type='follow' 通知（复用 lib/supabase 的 createNotification）。

import { supabase } from "./supabaseClient"
import { createNotification } from "./supabase"

// 关注列表里的一个用户条目（带展示用资料）
export type FollowUser = {
  id: string
  username: string | null
  avatar_url: string | null
  bio: string | null
}

// 关注某人。幂等：主键冲突(23505)视为「已关注」直接当成功，不报错。
// 成功后给被关注者发一条 follow 通知（失败不影响关注本身）。
export async function followUser(
  followerId: string,
  followingId: string,
  actorName?: string,
): Promise<void> {
  if (followerId === followingId) return
  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: followerId, following_id: followingId })
  if (error && (error as { code?: string }).code !== "23505") throw error

  // 通知被关注者（非阻塞、失败仅告警）
  try {
    await createNotification({
      userId: followingId,
      type: "follow",
      actorId: followerId,
      message: `${actorName || "有人"} 关注了你`,
    })
  } catch (e) {
    console.warn("发送关注通知失败:", e)
  }
}

// 取消关注。删除不存在的行不报错（RLS 限定只能删自己发起的）。
export async function unfollowUser(followerId: string, followingId: string): Promise<void> {
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", followerId)
    .eq("following_id", followingId)
  if (error) throw error
}

// 我(followerId) 是否已关注 targetId
export async function isFollowing(followerId: string, targetId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("follower_id", followerId)
    .eq("following_id", targetId)
  if (error) return false
  return (count ?? 0) > 0
}

export type FollowCounts = { followers: number; following: number }

// 某用户的粉丝数(被多少人关注) + 关注数(关注了多少人)。一次并发取两个 count。
export async function getFollowCounts(userId: string): Promise<FollowCounts> {
  const [followersRes, followingRes] = await Promise.all([
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("following_id", userId),
    supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("follower_id", userId),
  ])
  return {
    followers: followersRes.count ?? 0,
    following: followingRes.count ?? 0,
  }
}

// 两步查询（不依赖 follows→profiles 的外键关系，更稳）：
//   ① 从 follows 取出对方 id 列表（按关注时间倒序）
//   ② 一次性到 profiles 批量取这些 id 的展示资料
// 再按 ① 的顺序回排，保证「最近关注/最新粉丝」在前。
async function hydrateProfiles(ids: string[]): Promise<FollowUser[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, avatar_url, bio")
    .in("id", ids)
  if (error || !data) return []
  const map = new Map(data.map((p) => [p.id, p as FollowUser]))
  return ids
    .map((id) => map.get(id))
    .filter((u): u is FollowUser => !!u)
}

// 某用户的粉丝列表（关注了 Ta 的人），最新在前
export async function getFollowers(userId: string, limit = 100): Promise<FollowUser[]> {
  const { data, error } = await supabase
    .from("follows")
    .select("follower_id, created_at")
    .eq("following_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return hydrateProfiles(data.map((r) => r.follower_id as string))
}

// 某用户关注的人，最新在前
export async function getFollowing(userId: string, limit = 100): Promise<FollowUser[]> {
  const { data, error } = await supabase
    .from("follows")
    .select("following_id, created_at")
    .eq("follower_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return hydrateProfiles(data.map((r) => r.following_id as string))
}
