import { supabase } from "./supabaseClient"
import type { Post, Comment } from "./types"
import { cache, withCache } from "./cache-utils"
import { postsHaveImageUrls } from "./post-images"

// 内存缓存
const memoryCache = new Map<string, { data: any; expiry: number }>()

// 定期清理过期缓存
setInterval(() => {
  const now = Date.now()
  for (const [key, item] of memoryCache.entries()) {
    if (item.expiry <= now) {
      memoryCache.delete(key)
    }
  }
}, 5 * 60 * 1000) // 每5分钟清理一次

// 优化的查询函数
export async function optimizedQuery<T>(
  queryFn: () => Promise<{ data: T; error: any }>,
  cacheKey: string,
  cacheDuration = 60, // 默认缓存60秒
): Promise<T> {
  // 检查缓存
  const now = Date.now()
  const cachedItem = memoryCache.get(cacheKey)

  if (cachedItem && cachedItem.expiry > now) {
    return cachedItem.data
  }

  // 如果没有缓存或缓存过期，执行查询
  try {
    const { data, error } = await queryFn()

    if (error) {
      console.error(`❌ 查询错误 (${cacheKey}):`, error);
      throw error
    }

    // 更新缓存
    if (data) {
      memoryCache.set(cacheKey, {
        data,
        expiry: now + cacheDuration * 1000,
      })
    }

    return data
  } catch (error) {
    console.error(`🔥 查询失败 (${cacheKey}):`, error);
    throw error
  }
}

// 优化的获取帖子函数 - 使用JOIN和子查询减少请求次数
export const getPostsOptimized = withCache(
  async (): Promise<Post[]> => {
    try {
      // 获取帖子基本数据和计数，不包含用户信息
      const withUrls = await postsHaveImageUrls()
      const { data: postsWithCounts, error } = await supabase
        .from("posts")
        .select(postSelect(withUrls))
        .order("created_at", { ascending: false })
        .limit(1000) // 增加加载数量限制到1000，确保能显示足够多的帖子

      if (error) {
        console.error("❌ 获取帖子失败:", error);
        // 返回空数组而不是抛出错误，避免UI崩溃
        return [];
      }
      
      if (!postsWithCounts || postsWithCounts.length === 0) {
        return [];
      }

      // 获取所有用户ID
      const userIds = postsWithCounts
        .map(post => post.user_id)
        .filter((id, index, self) => id && self.indexOf(id) === index); // 去重
        
      // 用户名和头像映射表
      const usernameMap = new Map<string, string>();
      const avatarMap = new Map<string, string>();
      
      // 批量获取用户名 - 从 profiles 表查询（user_profiles 表 RLS 限制无法读取）
      if (userIds.length > 0) {
        try {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, username, avatar_url")
            .in("id", userIds);

          if (profiles && profiles.length > 0) {
            profiles.forEach(profile => {
              if (profile.id && profile.username) {
                // 邮箱格式取 @ 前部分
                const username = profile.username.includes('@')
                  ? profile.username.split('@')[0]
                  : profile.username;
                if (username) usernameMap.set(profile.id, username);
              }
              if (profile.id && profile.avatar_url) {
                avatarMap.set(profile.id, profile.avatar_url);
              }
            });
          }
        } catch (err) {
          console.warn("获取profiles失败:", err);
        }
      }

      // 处理数据，转换为客户端格式
      const processedPosts = postsWithCounts.map(post => {
        try {
          // 确保 image_ratio 是有效值
          let imageRatio = post.image_ratio || 1.0
          // 限制比例在合理范围内
          imageRatio = Math.min(Math.max(imageRatio, 0.5), 2.0)

          // 获取点赞数和评论数
          let likesCount = 0;
          let commentsCount = 0;
          
          try {
            if (post.likes && post.likes.length > 0) {
              // 安全地将count转换为数字
              const count = post.likes[0].count;
              likesCount = typeof count === 'string' ? parseInt(count) : (typeof count === 'number' ? count : 0);
            }
          } catch (e) {
            console.warn("解析点赞数出错:", e);
          }
          
          try {
            if (post.comments && post.comments.length > 0) {
              // 安全地将count转换为数字
              const count = post.comments[0].count;
              commentsCount = typeof count === 'string' ? parseInt(count) : (typeof count === 'number' ? count : 0);
            }
          } catch (e) {
            console.warn("解析评论数出错:", e);
          }
          
          // 获取用户名 - 使用之前查询的映射
          let displayUsername = usernameMap.get(post.user_id) || `用户_${post.user_id.substring(0, 6)}`;

          // 创建符合Post类型的对象
          const processedPost: Post = {
            id: post.id,
            user_id: post.user_id,
            title: post.title,
            content: post.content,
            description: post.description,
            category: post.category,
            image_url: post.image_url,
            image_urls: Array.isArray(post.image_urls) && post.image_urls.length ? post.image_urls : (post.image_url ? [post.image_url] : undefined),
            image_ratio: imageRatio,
            created_at: post.created_at,
            likes: 0, // 填充必需字段
            comments: 0, // 填充必需字段
            likes_count: likesCount,
            comments_count: commentsCount,
            username: displayUsername,
            users: {
              id: post.user_id,
              username: displayUsername,
              avatar_url: avatarMap.get(post.user_id),
            },
            imageContent: post.image_url ? undefined : ["+", "X", "O", "□", "△", "◇"][Math.floor(Math.random() * 6)],
          };

          return processedPost;
        } catch (err) {
          // 处理单个帖子时出错，返回一个基本对象避免整个列表失败
          console.error("处理单个帖子时出错:", err);
          return {
            id: post.id || "unknown",
            user_id: post.user_id || "unknown",
            title: post.title || "帖子标题加载错误",
            content: post.content || "",
            description: post.description || "",
            category: post.category || "其他",
            created_at: post.created_at || new Date().toISOString(),
            likes: 0,
            comments: 0,
            likes_count: 0,
            comments_count: 0,
            username: "用户_未知",
            imageContent: "X"
          } as Post;
        }
      });

      return processedPosts.filter(post => post !== null);
    } catch (error) {
      console.error("❌ 获取帖子失败:", error);
      // 返回空数组而不是抛出错误，避免UI崩溃
      return [];
    }
  },
  "all-posts",
  60 // 缓存60秒
);

// 主流程使用 getPostsPaginated 负责分页拉取帖子。

// 批量获取点赞状态 - 一次查询多个帖子的点赞状态
export const checkMultipleUserLikes = withCache(
  async (postIds: string[], userId: string): Promise<Record<string, boolean>> => {
    if (!userId || postIds.length === 0) {
      return {}
    }

    try {
      const { data, error } = await supabase
        .from("likes")
        .select("post_id")
        .eq("user_id", userId)
        .in("post_id", postIds)

      if (error) throw error

      const likedPostIds = new Set((data || []).map(like => like.post_id))
      
      return postIds.reduce((acc, postId) => {
        acc[postId] = likedPostIds.has(postId)
        return acc
      }, {} as Record<string, boolean>)
    } catch (error) {
      return {}
    }
  },
  "multiple_likes",
  60
)

// 获取帖子的详细统计信息
export const getPostStats = withCache(
  async (postId: string): Promise<{ likes_count: number; comments_count: number }> => {
    try {
      // 并行查询点赞数和评论数
      const [likesResult, commentsResult] = await Promise.all([
        supabase
          .from("likes")
          .select("*", { count: "exact", head: true })
          .eq("post_id", postId),
        supabase
          .from("comments")
          .select("*", { count: "exact", head: true })
          .eq("post_id", postId)
      ])

      return {
        likes_count: likesResult.count || 0,
        comments_count: commentsResult.count || 0
      }
    } catch (error) {
      return { likes_count: 0, comments_count: 0 }
    }
  },
  "post_stats",
  30
)

// 清理优化过的Supabase函数缓存
export function clearOptimizedCache() {
  // @ts-ignore
  if (withCache && withCache.cache) {
    // @ts-ignore
    withCache.cache.clear()
  }
}

// 在window对象上暴露清理函数，方便调试
if (typeof window !== "undefined") {
  // @ts-ignore
  window.clearSupabaseCache = clearOptimizedCache
}

// 优化的实时订阅 - 减少重新获取频率
export function subscribeToPostsUpdatesOptimized(callback: (posts: Post[]) => void, forceRefresh: boolean = false) {
  let updateTimeout: NodeJS.Timeout | null = null
  let hasInitialized = false
  let isUpdating = false
  let retryCount = 0
  const maxRetries = 3
  
  // 初始加载 - 使用 setTimeout 避免同步执行
  setTimeout(async () => {
    try {
      // 如果是强制刷新，先清除缓存
      if (forceRefresh) {
        cache.delete("posts:");
      }
      
      // 获取所有帖子，确保不丢失旧帖子
      const posts = await getPostsOptimized()
      hasInitialized = true
      callback(posts)
      retryCount = 0 // 重置重试计数
    } catch (error) {
      hasInitialized = true
      callback([]) // 即使出错，也触发回调以避免无限加载
    }
  }, 0)

  // 防抖更新函数
  const debouncedUpdate = () => {
    if (!hasInitialized || isUpdating) {
      return
    }
    
    if (updateTimeout) {
      clearTimeout(updateTimeout)
    }
    
    updateTimeout = setTimeout(async () => {
      if (isUpdating) return
      
      try {
        isUpdating = true
        
        // 检查重试次数
        if (retryCount >= maxRetries) {
          return
        }
        
        // 清除缓存并重新获取
        cache.delete("posts:")
        const posts = await getPostsOptimized()
        callback(posts)
        retryCount = 0 // 成功后重置重试计数
      } catch (error) {
        retryCount++
        
        // 如果重试次数未超限，设置更长的延迟后重试
        if (retryCount < maxRetries) {
          setTimeout(() => {
            if (updateTimeout) {
              clearTimeout(updateTimeout)
            }
            debouncedUpdate()
          }, retryCount * 2000) // 递增延迟
        }
      } finally {
        isUpdating = false
      }
    }, 2000) // 增加防抖时间到2秒
  }

  // 订阅帖子表的变化
  const subscription = supabase
    .channel("posts-channel")
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, debouncedUpdate)
    .on("postgres_changes", { event: "*", schema: "public", table: "likes" }, debouncedUpdate)
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, debouncedUpdate)
    .subscribe()

  // 返回清理函数
  return () => {
    if (updateTimeout) {
      clearTimeout(updateTimeout)
    }
    subscription.unsubscribe()
    isUpdating = false
    retryCount = 0
  }
}

// ===== 评论优化函数 =====

// 优化的获取评论函数 - 使用缓存和JOIN查询
export const getCommentsOptimized = withCache(
  async (postId: string): Promise<Comment[]> => {
    try {
      // 使用单个查询获取所有评论和用户信息
      const { data, error } = await supabase
        .from("comments")
        .select(`
          id,
          content,
          created_at,
          user_id,
          parent_id,
          post_id,
          profiles:user_id (
            id,
            username,
            avatar_url
          )
        `)
        .eq("post_id", postId)
        .order("created_at", { ascending: false })

      if (error) {
        throw error
      }

      // 构建评论树状结构
      const comments = buildCommentTree(data || [])
      
      return comments
    } catch (error) {
      throw error
    }
  },
  "comments",
  30 // 缓存30秒
)

// 构建评论树状结构的辅助函数
function buildCommentTree(flatComments: any[]): Comment[] {
  const map = new Map<string, Comment & { replies: Comment[] }>()
  const roots: Comment[] = []

  // 预处理所有评论
  flatComments.forEach((comment) => {
    // 处理profiles字段，可能是数组或对象
    const userInfo = Array.isArray(comment.profiles) ? comment.profiles[0] : comment.profiles
    
    map.set(comment.id, {
      ...comment,
      username: userInfo?.username || "匿名用户",
      user: userInfo || null,
      replies: [],
    })
  })

  // 构建树状结构
  map.forEach((comment) => {
    if (comment.parent_id) {
      const parent = map.get(comment.parent_id)
      if (parent) {
        parent.replies.push(comment)
      }
    } else {
      roots.push(comment)
    }
  })

  return roots
}

// 优化的添加评论函数 - 支持乐观更新
export async function addCommentOptimized(
  postId: string,
  userId: string,
  content: string,
  parentId?: string
): Promise<Comment> {
  try {
    // 准备评论数据
    const commentData = {
      post_id: postId,
      user_id: userId,
      content: content.trim(),
      parent_id: parentId || null,
      created_at: new Date().toISOString(),
    }

    // 执行数据库插入
    const { data, error } = await supabase
      .from("comments")
      .insert([commentData])
      .select(`
        id,
        content,
        created_at,
        user_id,
        parent_id,
        post_id,
        profiles:user_id (
          id,
          username,
          avatar_url
        )
      `)
      .single()

    if (error) {
      throw error
    }

    // 立即清除相关缓存
    cache.delete(`comments:["${postId}"]`)
    cache.delete(`post_stats:["${postId}"]`)
    
    // 返回格式化的评论数据
    const userInfo = (data as any).profiles
    return {
      ...data,
      username: Array.isArray(userInfo) ? userInfo[0]?.username : userInfo?.username || "匿名用户",
      user: Array.isArray(userInfo) ? userInfo[0] : userInfo || null,
      replies: [],
      likes_count: 0, // 默认为0，因为新评论还没有点赞
    }
  } catch (error) {
    throw error
  }
}

// 实时订阅评论更新 - 优化版本
export function subscribeToCommentsOptimized(
  postId: string,
  callback: (comments: Comment[]) => void
) {
  let updateTimeout: NodeJS.Timeout | null = null
  
  // 初始加载评论
  getCommentsOptimized(postId).then(callback).catch(() => {})

  // 防抖更新函数
  const debouncedUpdate = () => {
    if (updateTimeout) {
      clearTimeout(updateTimeout)
    }
    
    updateTimeout = setTimeout(async () => {
      try {
        // 清除缓存并重新获取
        cache.delete(`comments:["${postId}"]`)
        const comments = await getCommentsOptimized(postId)
        callback(comments)
      } catch (error) {
        // 静默处理错误
      }
    }, 500) // 减少到500ms防抖
  }

  // 订阅特定帖子的评论变化
  const subscription = supabase
    .channel(`comments-optimized-${postId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "comments",
        filter: `post_id=eq.${postId}`,
      },
      debouncedUpdate
    )
    .subscribe()

  // 返回清理函数
  return () => {
    if (updateTimeout) {
      clearTimeout(updateTimeout)
    }
    subscription.unsubscribe()
  }
}

// 批量更新评论计数
export async function updateCommentsCount(postId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from("comments")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId)

    if (error) throw error
    
    // 清除相关缓存
    cache.delete(`post_stats:["${postId}"]`)
    
    return count || 0
  } catch (error) {
    return 0
  }
}

// 全局缓存清除函数
export function clearAllCache() {
  try {
    // 清除withCache系统的缓存
    cache.clear();
    
    // 清除内存缓存
    memoryCache.clear();
    
    // 清除指定的重要缓存键
    const importantKeys = ["posts:", "posts_paginated:", "post_stats:", "comments:", "multiple_likes:"];
    
    importantKeys.forEach(key => {
      try {
        cache.delete(key);
      } catch (e) {
        // 忽略错误
      }
    });
    
    // 也调用clearOptimizedCache来确保所有缓存都被清除
    clearOptimizedCache();
    
    return true;
  } catch (err) {
    console.error("清理缓存时出错:", err);
    return false;
  }
}

// 在window对象上暴露缓存清除函数供其他组件使用
if (typeof window !== 'undefined') {
  // @ts-ignore
  window.clearSupabaseCache = clearOptimizedCache;
}

// posts 表标准查询字段（含点赞/评论计数）。多处查询复用，避免重复字符串。
// withUrls=false 时省略 image_urls（多图列尚未迁移时回退，避免整表查询报错）。
const postSelect = (withUrls: boolean) => `
  id,
  title,
  content,
  description,
  category,
  image_url,${withUrls ? "\n  image_urls," : ""}
  image_ratio,
  created_at,
  user_id,
  likes:likes(count),
  comments:comments(count)
`;

// 分页获取帖子。可选 category 过滤器。
export const getPostsPaginated = withCache(
  async (page: number = 0, limit: number = 30, category: string | null = null): Promise<Post[]> => {
    try {
      let query = supabase
        .from("posts")
        .select(postSelect(await postsHaveImageUrls()))
        .order("created_at", { ascending: false })
        .range(page * limit, page * limit + limit - 1);
      if (category) query = query.eq("category", category);

      const { data, error } = await query;
      if (error) {
        console.error("❌ 获取帖子失败:", error);
        return [];
      }
      return await processPostsData(data);
    } catch (error) {
      console.error("❌ 获取帖子失败:", error);
      return [];
    }
  },
  "posts-paginated", // withCache 会自动追加 args 的 JSON 作为完整 cache key
  30 // 缓存30秒
);

// 热度分页：走 hot_posts RPC（scripts/2026-06-13-hot-posts-rpc.sql），
// 数据库端按 赞×2+评论×3 全库排序。RPC 返回 SETOF posts，
// 可直接 .select(POST_SELECT) 嵌套计数，后续处理与 getPostsPaginated 完全一致。
export const getHotPostsPaginated = withCache(
  async (page: number = 0, limit: number = 30, category: string | null = null): Promise<Post[]> => {
    try {
      const { data, error } = await supabase
        .rpc("hot_posts", {
          p_offset: page * limit,
          p_limit: limit,
          p_category: category,
        })
        .select(postSelect(await postsHaveImageUrls()));
      if (error) {
        console.error("❌ 获取热度帖子失败:", error);
        return [];
      }
      return await processPostsData(data as any[]);
    } catch (error) {
      console.error("❌ 获取热度帖子失败:", error);
      return [];
    }
  },
  "posts-hot-paginated",
  30
);

// 获取某用户的全部帖子（社交个人页 /user 用）。复用 POST_SELECT + processPostsData；
// 用户帖子量通常不大，一次拉到上限即可（无需分页）。
export const getUserPosts = withCache(
  async (userId: string, limit: number = 100): Promise<Post[]> => {
    try {
      const { data, error } = await supabase
        .from("posts")
        .select(postSelect(await postsHaveImageUrls()))
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) {
        console.error("❌ 获取用户帖子失败:", error);
        return [];
      }
      return await processPostsData(data);
    } catch (error) {
      console.error("❌ 获取用户帖子失败:", error);
      return [];
    }
  },
  "user-posts",
  30,
);

// 批量拉取 profiles，返回 用户名/头像 映射。
async function fetchProfileMaps(
  userIds: string[],
): Promise<{ usernameMap: Map<string, string>; avatarMap: Map<string, string> }> {
  const usernameMap = new Map<string, string>();
  const avatarMap = new Map<string, string>();

  // 去重，过滤空值
  const uniqueIds = userIds.filter((id, index, self) => id && self.indexOf(id) === index);
  if (uniqueIds.length === 0) return { usernameMap, avatarMap };

  // 批量获取用户名 - 使用 profiles 表（user_profiles 表 RLS 限制无法读取）
  try {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, username, avatar_url")
      .in("id", uniqueIds);

    if (profiles && profiles.length > 0) {
      profiles.forEach(profile => {
        if (profile.id && profile.username) {
          // 如果是邮箱格式，提取用户名部分
          if (profile.username.includes('@')) {
            const emailUsername = profile.username.split('@')[0];
            if (emailUsername) {
              usernameMap.set(profile.id, emailUsername);
            }
          } else {
            // 非邮箱格式直接使用
            usernameMap.set(profile.id, profile.username);
          }
        }
        if (profile.id && profile.avatar_url) {
          avatarMap.set(profile.id, profile.avatar_url);
        }
      });
    }
  } catch (err) {
    console.warn("获取profiles失败:", err);
  }

  return { usernameMap, avatarMap };
}

// 纯映射：用预取的 profile 映射，把原始 posts 转成客户端 Post 格式，不发任何网络请求。
function mapPostsWithProfiles(
  posts: any[],
  usernameMap: Map<string, string>,
  avatarMap: Map<string, string>,
): Post[] {
  // 处理数据，转换为客户端格式
  return posts.map(post => {
    try {
      // 确保 image_ratio 是有效值
      let imageRatio = post.image_ratio || 1.0
      // 限制比例在合理范围内
      imageRatio = Math.min(Math.max(imageRatio, 0.5), 2.0)

      // 获取点赞数和评论数
      let likesCount = 0;
      let commentsCount = 0;
      
      try {
        if (post.likes && post.likes.length > 0) {
          // 安全地将count转换为数字
          const count = post.likes[0].count;
          likesCount = typeof count === 'string' ? parseInt(count) : (typeof count === 'number' ? count : 0);
        }
      } catch (e) {
        console.warn("解析点赞数出错:", e);
      }
      
      try {
        if (post.comments && post.comments.length > 0) {
          // 安全地将count转换为数字
          const count = post.comments[0].count;
          commentsCount = typeof count === 'string' ? parseInt(count) : (typeof count === 'number' ? count : 0);
        }
      } catch (e) {
        console.warn("解析评论数出错:", e);
      }
      
      // 获取用户名 - 使用之前查询的映射
      let displayUsername = usernameMap.get(post.user_id) || `用户_${post.user_id.substring(0, 6)}`;

      // 创建符合Post类型的对象
      const processedPost: Post = {
        id: post.id,
        user_id: post.user_id,
        title: post.title,
        content: post.content,
        description: post.description,
        category: post.category,
        image_url: post.image_url,
        image_urls: Array.isArray(post.image_urls) && post.image_urls.length ? post.image_urls : (post.image_url ? [post.image_url] : undefined),
        image_ratio: imageRatio,
        created_at: post.created_at,
        likes: 0, // 填充必需字段
        comments: 0, // 填充必需字段
        likes_count: likesCount,
        comments_count: commentsCount,
        username: displayUsername,
        users: {
          id: post.user_id,
          username: displayUsername,
          avatar_url: avatarMap.get(post.user_id),
        },
        imageContent: post.image_url ? undefined : ["+", "X", "O", "□", "△", "◇"][Math.floor(Math.random() * 6)],
      };

      return processedPost;
    } catch (err) {
      // 处理单个帖子时出错，返回一个基本对象避免整个列表失败
      console.error("处理单个帖子时出错:", err);
      return {
        id: post.id || "unknown",
        user_id: post.user_id || "unknown",
        title: post.title || "帖子标题加载错误",
        content: post.content || "",
        description: post.description || "",
        category: post.category || "其他",
        created_at: post.created_at || new Date().toISOString(),
        likes: 0,
        comments: 0,
        likes_count: 0,
        comments_count: 0,
        username: "用户_未知",
        imageContent: "X",
      } as Post;
    }
  });
}

// 辅助函数：处理帖子数据（拉取 profile + 映射）。
async function processPostsData(posts: any[]): Promise<Post[]> {
  if (!posts || !posts.length) return [];
  const { usernameMap, avatarMap } = await fetchProfileMaps(posts.map(post => post.user_id));
  return mapPostsWithProfiles(posts, usernameMap, avatarMap);
}
