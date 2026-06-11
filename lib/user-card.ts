// lib/user-card.ts —— 头像 hover 社交卡片的数据获取
// 统计项全部来自真实数据：帖子数、获赞数(该用户所有帖子收到的赞总和)、粉丝数。
// 注：项目暂无「浏览量」与「等级」字段，等级在前端按发帖/获赞推算(纯展示，不落库)。
import { supabase } from "@/lib/supabaseClient"
import { getPublicProfile, type Profile } from "@/lib/profiles"

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

// 拉取某用户的卡片统计。三个 count 全并发、单轮往返。
// 获赞数用 likes!inner join posts 按作者过滤直接数（依赖 likes.post_id→posts.id 外键），
// 不再「先拉帖子 id 列表、再数赞」两段串行——那是双倍 RTT，国内访问尤其慢。
export async function getUserCardStats(userId: string): Promise<UserCardStats> {
  try {
    const [postsRes, followersRes, likesRes] = await Promise.all([
      supabase.from("posts").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", userId),
      supabase
        .from("likes")
        .select("posts!inner(user_id)", { count: "exact", head: true })
        .eq("posts.user_id", userId),
    ])

    const posts = postsRes.count ?? 0
    const followers = followersRes.count ?? 0
    const likes = likesRes.count ?? 0

    return { posts, likes, followers, level: deriveLevel(posts, likes) }
  } catch {
    return { posts: 0, likes: 0, followers: 0, level: 1 }
  }
}

// ───────── 卡片数据缓存（profile + stats 一把抓，SWR 语义） ─────────
// 解决「hover 弹卡先显示 0、下一秒才出真数据」：
//   1. 帖子卡片挂载后空闲预热 + 触发区 pointerenter 预取——hover 时缓存通常已就绪；
//   2. 模块级缓存按 userId 共享——同一用户在任何帖子/聊天卡上 hover 都秒开；
//   3. stale-while-revalidate：过期旧值照样先显示（比占位符强），后台刷新后静默更新；
//   4. in-flight 去重，预热/预取/开卡不会重复打查询。

export interface UserCardData {
  profile: Profile | null
  stats: UserCardStats
}

// 新鲜期：60s 内直接用缓存不发请求；过期后旧值仍可展示，仅触发后台刷新
const CARD_FRESH_TTL = 60_000
const cardCache = new Map<string, { at: number; data: UserCardData }>()
const cardInflight = new Map<string, Promise<UserCardData>>()

// 同步读缓存。allowStale=true 时过期旧值也返回（开卡先显示旧值，配合 fetch 静默刷新）。
export function peekUserCardData(
  userId: string,
  opts?: { allowStale?: boolean },
): UserCardData | null {
  const hit = cardCache.get(userId)
  if (!hit) return null
  if (opts?.allowStale || Date.now() - hit.at < CARD_FRESH_TTL) return hit.data
  return null
}

// 拉取（带新鲜期缓存 + 并发去重）。预热、pointerenter 预取与开卡加载都走这里：
// 新鲜缓存直接 resolve（零网络），过期/未缓存才真正发请求。
export function fetchUserCardData(userId: string): Promise<UserCardData> {
  const fresh = peekUserCardData(userId)
  if (fresh) return Promise.resolve(fresh)
  const pending = cardInflight.get(userId)
  if (pending) return pending
  const p = Promise.all([getPublicProfile(userId), getUserCardStats(userId)])
    .then(([profile, stats]) => {
      const data: UserCardData = { profile, stats }
      cardCache.set(userId, { at: Date.now(), data })
      return data
    })
    .finally(() => {
      cardInflight.delete(userId)
    })
  cardInflight.set(userId, p)
  return p
}
