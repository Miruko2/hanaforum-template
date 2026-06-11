// lib/user-card.ts —— 头像 hover 社交卡片的数据获取
// 统计项全部来自真实数据：帖子数、获赞数(该用户所有帖子收到的赞总和)、粉丝数。
// 注：项目暂无「浏览量」与「等级」字段，等级在前端按发帖/获赞推算(纯展示，不落库)。
import { supabase } from "@/lib/supabaseClient"

export interface UserCardStats {
  posts: number // 帖子数
  likes: number // 获赞总数（该用户所有帖子收到的赞）
  followers: number // 粉丝数
  level: number // 前端推算的等级（不落库）
}

// 根据发帖数与获赞数推算一个轻量等级（纯展示用）。
// 设计：等级随活跃度平滑增长，避免新用户都堆在 1 级又不至于膨胀过快。
export function deriveLevel(posts: number, likes: number): number {
  const score = posts * 2 + likes
  // sqrt 增长：score 0→1 级，8→2 级，24→3 级，48→4 级 …
  return Math.max(1, Math.floor(Math.sqrt(score / 2)) + 1)
}

// 拉取某用户的卡片统计。三个 count 查询 + 一次帖子 id 列表查询，全部并发。
export async function getUserCardStats(userId: string): Promise<UserCardStats> {
  try {
    // 先并发取：帖子数(count)、粉丝数(count)、该用户帖子的 id 列表(用于汇总获赞)
    const [postsCountRes, followersRes, postIdsRes] = await Promise.all([
      supabase.from("posts").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", userId),
      supabase.from("posts").select("id").eq("user_id", userId),
    ])

    const posts = postsCountRes.count ?? 0
    const followers = followersRes.count ?? 0

    // 获赞总数：该用户所有帖子收到的赞之和。无帖子直接 0，省一次查询。
    const postIds = (postIdsRes.data ?? []).map((p: { id: string }) => p.id)
    let likes = 0
    if (postIds.length > 0) {
      const likesRes = await supabase
        .from("likes")
        .select("*", { count: "exact", head: true })
        .in("post_id", postIds)
      likes = likesRes.count ?? 0
    }

    return { posts, likes, followers, level: deriveLevel(posts, likes) }
  } catch {
    return { posts: 0, likes: 0, followers: 0, level: 1 }
  }
}
