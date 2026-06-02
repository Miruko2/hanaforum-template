import { supabase } from "./supabaseClient"
import type { Comment } from "./types"
import { queueNewPost, removePostFromQueue } from "./post-realtime-update"

// 本地缓存点赞状态，避免频繁请求
const likeStatusCache = new Map<string, boolean>()

// 获取用户资料信息 - 添加缓存
const profileCache = new Map<string, any>()

// 全局声明
declare global {
  interface Window {
    _refreshPostsList?: () => void;
  }
}

// 智能缓存清理，只清理特定类型或ID相关的缓存
export function smartClearCache(type: 'post' | 'comment' | 'profile' | 'all', id?: string) {
  if (type === 'all') {
    // 全部清理，仅在绝对必要时使用
    likeStatusCache.clear();
    profileCache.clear();
    return;
  }
  
  if (type === 'profile' && id) {
    // 清理特定用户的资料缓存
    profileCache.delete(id);
    return;
  }

  // 清理与特定帖子或评论相关的点赞缓存
  if (id) {
    // 遍历并删除符合条件的缓存项
    for (const key of likeStatusCache.keys()) {
      if (type === 'post' && key.startsWith(`${id}:`)) {
        likeStatusCache.delete(key);
      } else if (type === 'comment' && key.startsWith(`comment:${id}:`)) {
        likeStatusCache.delete(key);
      }
    }
  }
}

// 获取用户资料信息 - 添加缓存
export async function getUserProfile(userId: string) {
  if (!userId) return null

  // 检查缓存
  if (profileCache.has(userId)) {
    return profileCache.get(userId)
  }

  try {
    const { data, error } = await supabase.from("profiles").select("username, avatar_url").eq("id", userId).single()

    if (error) {
      console.error("获取用户信息失败:", error)
      return null
    }

    // 缓存结果
    profileCache.set(userId, data)
    return data
  } catch (error) {
    console.error("获取用户信息时出错:", error)
    return null
  }
}

// 改进 createPost 函数，增强会话处理和错误报告
export async function createPost({
  title,
  content,
  description,
  category,
  image_url,
  image_ratio,
}: {
  title: string
  content: string
  description: string
  category: string
  image_url?: string
  image_ratio?: number
}) {
  // 增加超时时间，以适应移动网络可能的延迟
  const timeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('数据库连接超时')), 25000)
  )

  try {
    // 获取用户会话
    let userId = '';
    let userSession = null;
    
    // 尝试多种方式获取用户ID
    try {
      // 方法1: 直接使用当前会话
      const { data: sessionData } = await Promise.race([
        supabase.auth.getSession(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('会话获取超时')), 8000))
      ]) as any;
      
      if (sessionData?.session?.user?.id) {
        userId = sessionData.session.user.id;
        userSession = sessionData.session;
      } 
      // 方法2: 如果没有会话，尝试从所有可能的存储位置获取
      else {
        // 尝试从各种存储位置恢复
        const storageKeys = [
          'sb-https-session', 'sb-session',  // 标准存储键
          'firefly-session-data',           // 自定义备份
          'last-known-user-id'             // 应急备份
        ];
        
        // 尝试所有可能的键
        for (const key of storageKeys) {
          if (userId) break; // 已找到，停止搜索
          
          const sessionStr = localStorage.getItem(key);
          if (!sessionStr || sessionStr === 'undefined' || sessionStr === 'null') continue;
          
          try {
            // 不同键有不同的数据格式
            if (key === 'last-known-user-id') {
              // 直接使用存储的用户ID
              userId = sessionStr;
              break;
            }
            
            const sessionObj = JSON.parse(sessionStr);
            if (sessionObj?.user?.id) {
              userId = sessionObj.user.id;
              
              // 使用恢复的会话强制刷新认证状态
              if (typeof window !== 'undefined' && window.httpsDebug?.refresh) {
                window.httpsDebug.refresh().catch(() => {});
              }
              break;
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    } catch (sessionError) {
      // 尝试从localStorage直接获取最后已知的用户ID
      const lastKnownUserId = localStorage.getItem('last-known-user-id');
      if (lastKnownUserId) {
        userId = lastKnownUserId;
      }
    }
    
    // 如果依然没有用户ID，则报错
    if (!userId) {
      throw new Error("未登录或会话已过期，请重新登录");
    }
    
    // 预处理数据，确保字段有效
    const safeTitle = title?.trim() || "无标题";
    const safeContent = content?.trim() || "无内容";
    const safeDescription = description?.trim() || "";
    const safeCategory = category?.trim() || "general";
    const safeImageRatio = image_ratio || 1.0;

    // 如果有会话，尝试刷新
    if (userSession && userSession.access_token) {
      try {
        await supabase.auth.setSession(userSession);
      } catch (e) {
        // 忽略会话刷新错误
      }
    }

    // 直接插入帖子数据，使用超时保护
    const insertPromise = supabase
      .from("posts")
      .insert([
        {
          title: safeTitle,
          content: safeContent,
          description: safeDescription,
          category: safeCategory,
          image_url: image_url || null,
          image_ratio: safeImageRatio,
          user_id: userId,
          likes: 0,
          comments: 0,
        },
      ])
      .select()

    const { data, error } = await Promise.race([
      insertPromise,
      timeout
    ]) as any

    if (error) {
      // 针对不同错误类型提供特定处理
      if (error.code === 'PGRST301' || error.message?.includes('timeout')) {
        throw new Error('数据库连接超时，请检查网络连接');
      } else if (error.code === '23505') {
        throw new Error('帖子创建冲突，请稍后重试');
      } else if (error.message?.includes('JWT') || error.message?.includes('auth') || error.message?.includes('认证')) {
        // 如果是认证错误，尝试强制刷新会话
        if (typeof window !== 'undefined' && window.httpsDebug?.refresh) {
          try {
            await window.httpsDebug.refresh();
            
            // 重试一次
            const retryResult = await supabase
              .from("posts")
              .insert([
                {
                  title: safeTitle,
                  content: safeContent,
                  description: safeDescription,
                  category: safeCategory,
                  image_url: image_url || null,
                  image_ratio: safeImageRatio,
                  user_id: userId,
                  likes: 0,
                  comments: 0,
                },
              ])
              .select();
              
            if (!retryResult.error) {
              // 触发自定义事件，通知帖子列表刷新
              if (typeof window !== 'undefined') {
                const formattedPost = {
                  ...retryResult.data?.[0],
                  likes_count: 0,
                  comments_count: 0,
                  username: "刚刚发布", // 临时用户名，将在列表刷新时更新
                  imageContent: retryResult.data?.[0].image_url ? undefined : ["+", "X", "O", "□", "△", "◇"][Math.floor(Math.random() * 6)]
                };
                
                // 直接将帖子加入实时队列
                queueNewPost(formattedPost);
                
                // 保留原始事件，以兼容其他可能依赖它的组件
                const event = new CustomEvent('postCreated', { 
                  detail: { post: formattedPost } 
                });
                window.dispatchEvent(event);
              }
              
              return retryResult.data;
            }
          } catch (retryError) {
            console.error("重试失败:", retryError);
          }
        }
        
        throw new Error('登录已过期，请重新登录');
      } else {
        throw new Error(error.message || '数据库操作失败');
      }
    }
    
    // 保存最后已知的用户ID，以便在会话恢复时使用
    try {
      localStorage.setItem('last-known-user-id', userId);
      localStorage.setItem('last-session-time', Date.now().toString());
    } catch (e) {
      // 忽略存储错误
    }
    
    // 只清理必要的缓存 - 替换全部缓存清理
    if (data?.[0]?.id) {
      // 只清理与新帖子关联的缓存
      smartClearCache('post', data[0].id);
    }
    
    // 触发自定义事件，通知帖子列表刷新
    if (typeof window !== 'undefined' && data && data[0]) {
      // 确保新帖子包含UI渲染所需的所有字段
      const formattedPost = {
        ...data[0],
        likes_count: 0,
        comments_count: 0,
        username: "刚刚发布", // 临时用户名，将在列表刷新时更新
        imageContent: data[0].image_url ? undefined : ["+", "X", "O", "□", "△", "◇"][Math.floor(Math.random() * 6)]
      };
      
      // 直接将帖子加入实时队列
      queueNewPost(formattedPost);
      
      // 保留原始事件，以兼容其他可能依赖它的组件
      const event = new CustomEvent('postCreated', { 
        detail: { post: formattedPost } 
      });
      window.dispatchEvent(event);
    }
    
    return data;
  } catch (error: any) {
    console.error("创建帖子错误:", error);
    
    // 统一错误处理
    if (error.message === '数据库连接超时') {
      throw new Error('网络连接不稳定，请稍后重试');
    } else if (error.message.includes('网络')) {
      throw new Error('网络连接异常，请检查网络后重试');
    } else {
      throw error;
    }
  }
}

// 获取帖子 - 优化批量处理用户数据和点赞/评论计数
export async function getPosts() {
  try {
    console.debug("从服务器获取最新帖子列表");
    
    // 获取帖子基本信息
    const { data: posts, error: postsError } = await supabase
      .from("posts")
      .select(
        "id, title, content, description, category, image_url, image_ratio, created_at, user_id"
      )
      .order("created_at", { ascending: false })
      .limit(1000) // 增加获取的帖子数量限制到1000

    if (postsError) {
      console.error("获取帖子错误:", postsError)
      throw postsError
    }

    if (!posts || posts.length === 0) {
      console.debug("没有找到帖子");
      return [];
    }
    
    console.debug(`成功获取${posts.length}个帖子`);
    
    // 收集所有帖子ID和用户ID用于批量查询
    const postIds = posts.map(post => post.id);
    const userIds = [...new Set(posts.map(post => post.user_id).filter(Boolean))];
    
    // 用于存储用户名映射
    const usernameMap = new Map();
    
    // 从 profiles 表批量获取用户信息（user_profiles 对 anon 无读权限，已移除该分支）
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, username")
      .in("id", userIds);

    if (profilesData) {
      profilesData.forEach(profile => {
        if (profile.username) {
          const username = profile.username.includes('@')
            ? profile.username.split('@')[0]
            : profile.username;
          if (username) usernameMap.set(profile.id, username);
        }
      });
    }
    
    // 对于没有找到用户名的用户，需要单独查询auth.users
    const missingUserIds = userIds.filter(id => !usernameMap.has(id));
    if (missingUserIds.length > 0) {
      // 由于无法批量查询auth.users，使用Promise.all并发查询
      const authUserPromises = missingUserIds.map(userId => 
        supabase.auth.getUser(userId).then(({ data }) => ({ userId, data }))
      );
      
      const authResults = await Promise.allSettled(authUserPromises);
      
      authResults.forEach(result => {
        if (result.status === 'fulfilled') {
          const { userId, data } = result.value;
          if (data?.user?.user_metadata?.username) {
            usernameMap.set(userId, data.user.user_metadata.username);
          } else if (data?.user?.email) {
            const emailParts = data.user.email.split('@');
            usernameMap.set(userId, emailParts[0]);
          }
        }
      });
    }
    
    // 为剩余没有找到用户名的用户ID设置默认值
    userIds.forEach(userId => {
      if (!usernameMap.has(userId)) {
        usernameMap.set(userId, `用户_${userId.substring(0, 6)}`);
      }
    });
    
    // 批量获取帖子的点赞数和评论数
    const [likesResultPromise, commentsResultPromise] = await Promise.allSettled([
      // 批量获取点赞计数
      supabase.from("likes")
        .select("post_id", { count: "exact" })
        .in("post_id", postIds)
        .then(async ({ data }) => {
          // 如果批量计数不可用，则手动统计
          if (!data) return {};
          
          // 计算每个帖子的点赞数
          const likesMap: Record<string, number> = {};
          const countPromises = postIds.map(postId => 
            supabase.from("likes")
              .select("*", { count: "exact", head: true })
              .eq("post_id", postId)
              .then(({ count }) => ({ postId, count }))
          );
          
          const results = await Promise.allSettled(countPromises);
          
          results.forEach(result => {
            if (result.status === 'fulfilled') {
              const { postId, count } = result.value;
              likesMap[postId] = count || 0;
            }
          });
          
          return likesMap;
        }),
      
      // 批量获取评论计数
      supabase.from("comments")
        .select("post_id", { count: "exact" })
        .in("post_id", postIds)
        .then(async ({ data }) => {
          // 如果批量计数不可用，则手动统计
          if (!data) return {};
          
          // 计算每个帖子的评论数
          const commentsMap: Record<string, number> = {};
          const countPromises = postIds.map(postId => 
            supabase.from("comments")
              .select("*", { count: "exact", head: true })
              .eq("post_id", postId)
              .then(({ count }) => ({ postId, count }))
          );
          
          const results = await Promise.allSettled(countPromises);
          
          results.forEach(result => {
            if (result.status === 'fulfilled') {
              const { postId, count } = result.value;
              commentsMap[postId] = count || 0;
            }
          });
          
          return commentsMap;
        })
    ]);
    
    // 获取点赞和评论计数结果
    const likesMap: Record<string, number> = likesResultPromise.status === 'fulfilled' ? likesResultPromise.value : {};
    const commentsMap: Record<string, number> = commentsResultPromise.status === 'fulfilled' ? commentsResultPromise.value : {};
    
    // 处理帖子数据
    const processedPosts = posts.map(post => {
      // 确保 image_ratio 是有效值
      let imageRatio = post.image_ratio || 1.0
      // 限制比例在合理范围内
      imageRatio = Math.min(Math.max(imageRatio, 0.5), 2.0)

      // 获取用户名和计数
      const displayUsername = usernameMap.get(post.user_id) || `用户_${post.user_id.substring(0, 6)}`;
      const likesCount = likesMap[post.id] || 0;
      const commentsCount = commentsMap[post.id] || 0;

      return {
        ...post,
        image_ratio: imageRatio,
        likes_count: likesCount,
        comments_count: commentsCount,
        username: displayUsername,
        imageContent: post.image_url ? undefined : ["+", "X", "O", "□", "△", "◇"][Math.floor(Math.random() * 6)],
      }
    });

    return processedPosts
  } catch (error) {
    console.error("获取帖子失败:", error)
    throw error
  }
}

// 获取单个帖子 - 优化查询效率
export async function getPost(postId: string) {
  try {
    const { data, error } = await supabase
      .from("posts")
      .select(`*`)
      .eq("id", postId)
      .single()

    if (error) throw error

    if (!data) {
      throw new Error("帖子不存在");
    }

    // 确保 image_ratio 是有效值
    let imageRatio = data.image_ratio || 1.0
    // 限制比例在合理范围内
    imageRatio = Math.min(Math.max(imageRatio, 0.5), 2.0)

    // 并行查询点赞数、评论数和用户信息
    const [likesResult, commentsResult, userResult] = await Promise.all([
      // 获取点赞数
      supabase
        .from("likes")
        .select("*", { count: "exact", head: true })
        .eq("post_id", postId),
      
      // 获取评论数
      supabase
        .from("comments")
        .select("*", { count: "exact", head: true })
        .eq("post_id", postId),
      
      // 并行查询用户信息（profiles 表 + auth.users 元数据，user_profiles 对 anon 无权限已移除）
      Promise.allSettled([
        // 1. profiles 表（anon 可读）
        supabase
          .from("profiles")
          .select("username")
          .eq("id", data.user_id)
          .maybeSingle(),
        
        // 2. auth.users 元数据（可能失败，但作为兜底）
        supabase.auth.getUser(data.user_id)
      ])
    ]);

    // 提取点赞数和评论数
    const likesCount = likesResult.count || 0;
    const commentsCount = commentsResult.count || 0;
    
    // 按优先级处理用户名
    let displayUsername = "";
    const userResultArray = userResult;
    
    // 1. 优先检查profiles表
    if (userResultArray[0].status === 'fulfilled' && userResultArray[0].value?.data?.username) {
      const username = userResultArray[0].value.data.username;
      // 如果是邮箱格式，提取用户名部分
      if (username.includes('@')) {
        const emailUsername = username.split('@')[0];
        displayUsername = emailUsername || username;
      } else {
        displayUsername = username;
      }
    }
    // 2. 检查auth.users元数据
    else if (userResultArray[1].status === 'fulfilled') {
      const authUser = userResultArray[1].value?.data;
      if (authUser?.user?.user_metadata?.username) {
        displayUsername = authUser.user.user_metadata.username;
      } else if (authUser?.user?.email) {
        const emailParts = authUser.user.email.split('@');
        displayUsername = emailParts[0];
      }
    }
    
    // 如果仍然没有用户名，使用ID的前几位作为标识符
    if (!displayUsername && data.user_id) {
      displayUsername = `用户_${data.user_id.substring(0, 6)}`;
    }

    const processedPost = {
      ...data,
      username: displayUsername,
      image_ratio: imageRatio,
      likes_count: likesCount,
      comments_count: commentsCount,
      imageContent: data.image_url ? undefined : ["+", "X", "O", "□", "△", "◇"][Math.floor(Math.random() * 6)],
    }

    return processedPost
  } catch (error) {
    console.error("获取单个帖子失败:", error)
    throw error
  }
}

// 检查用户是否已点赞 - 修复 count 可能为 null 的问题
export async function checkUserLiked(postId: string, userId: string) {
  // 生成缓存键
  const cacheKey = `${postId}:${userId}`

  // 检查缓存
  if (likeStatusCache.has(cacheKey)) {
    return likeStatusCache.get(cacheKey)
  }

  try {
    // 使用计数而不是select=id，避免406错误
    const { count, error } = await supabase
      .from("likes")
      .select("*", { count: "exact", head: true })
      .eq("post_id", postId)
      .eq("user_id", userId)

    if (error) {
      console.error("检查点赞状态错误:", error)
      return false
    }

    // 修复：确保 count 不为 null
    const isLiked = count !== null && count > 0

    // 缓存结果
    likeStatusCache.set(cacheKey, isLiked)

    // 设置缓存过期
    setTimeout(() => {
      likeStatusCache.delete(cacheKey)
    }, 30000) // 30秒后过期

    return isLiked
  } catch (e) {
    console.error("检查点赞状态异常:", e)
    return false
  }
}

// 创建通知
export async function createNotification({
  userId,
  type,
  postId,
  commentId,
  actorId,
  message,
}: {
  userId: string;
  type: 'like_post' | 'comment_post' | 'like_comment';
  postId?: string;
  commentId?: string;
  actorId?: string;
  message: string;
}) {
  try {
    console.debug('尝试创建通知:', { userId, type, postId, commentId, actorId, message });
    
    // 避免给自己发送通知
    if (userId === actorId) {
      console.debug('跳过创建通知: 自己给自己的操作不需要通知');
      return null;
    }

    // 首先验证数据是否符合约束条件
    if (type === 'like_post' && !postId) {
      console.error('通知创建失败: like_post类型必须提供postId');
      return null;
    }
    
    if (type === 'comment_post' && !postId) {
      console.error('通知创建失败: comment_post类型必须提供postId');
      return null;
    }
    
    if (type === 'like_comment' && !commentId) {
      console.error('通知创建失败: like_comment类型必须提供commentId');
      return null;
    }

    // 直接用带 JWT 的 REST 请求插入通知，绕开本项目偶发的
    // "通过 supabase 客户端写请求时掉登录态、以匿名身份发出" 问题
    //（该问题会让 INSERT 以 anon 身份发出、被 notifications 表 RLS 拦下，报 42501）。
    //
    // 注意：access_token 优先直接从 localStorage 取（这是经手动验证能拿到
    // 201 的可靠来源）；supabase.auth.getSession() 在本项目的自定义会话管理下
    // 有时会返回失效/匿名的 token，故仅作兜底。
    let accessToken: string | undefined;
    try {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem('supabase.auth.token');
        if (raw && raw !== 'undefined' && raw !== 'null') {
          const parsed = JSON.parse(raw);
          accessToken = parsed?.access_token || parsed?.currentSession?.access_token;
        }
      }
    } catch {
      // 解析失败则走兜底
    }
    if (!accessToken) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token;
      } catch {
        // 忽略
      }
    }
    if (!accessToken) {
      console.error('通知创建失败: 当前没有有效登录态(access_token)');
      return null;
    }

    const restUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}/rest/v1/notifications`;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    const resp = await fetch(restUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        // 关键：用 return=minimal 不回读插入行。
        // 通知的 user_id 是“接收者”(通常不是创建者本人)，而 SELECT 策略是
        // auth.uid() = user_id；PostgreSQL 对 INSERT...RETURNING 会同时校验 SELECT 策略，
        // 回读这条“发给别人的通知”会失败并报 42501（与 INSERT 被拦的报错相同，极易误判）。
        // minimal 跳过回读，INSERT 只走 WITH CHECK(actor_id = auth.uid()) 即可成功。
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        type,
        post_id: postId ?? null,
        comment_id: commentId ?? null,
        actor_id: actorId ?? null,
        message,
        is_read: false,
        created_at: new Date().toISOString(),
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('数据库创建通知失败:', errText);
      return null;
    }

    console.debug('通知创建成功');
    return true;
  } catch (error) {
    console.error('创建通知失败:', error);
    return null;
  }
}

// 管理员发布全员公告：调用 SECURITY DEFINER 函数 broadcast_announcement，
// 由数据库给所有用户各插一条 announcement 类型通知（服务端用 is_admin 鉴权）。
// 取 token 方式与 createNotification 一致：优先 localStorage，getSession 兜底
//（本项目 getSession 偶发返回失效/匿名 token）。
export async function broadcastAnnouncement(title: string, content: string): Promise<string> {
  let accessToken: string | undefined;
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('supabase.auth.token');
      if (raw && raw !== 'undefined' && raw !== 'null') {
        const parsed = JSON.parse(raw);
        accessToken = parsed?.access_token || parsed?.currentSession?.access_token;
      }
    }
  } catch {
    // 解析失败走兜底
  }
  if (!accessToken) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      accessToken = session?.access_token;
    } catch {
      // 忽略
    }
  }
  if (!accessToken) throw new Error('登录态失效，请重新登录后再发布');

  const rpcUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}/rest/v1/rpc/broadcast_announcement`;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ p_title: title, p_content: content }),
  });

  if (!resp.ok) {
    let msg = '';
    try {
      const j = await resp.json();
      msg = j?.message || j?.error || JSON.stringify(j);
    } catch {
      try { msg = await resp.text(); } catch { /* 忽略 */ }
    }
    throw new Error(msg || `发布失败 (${resp.status})`);
  }
  // RPC 标量返回：PostgREST 返回新公告的 uuid（JSON 字符串）
  return await resp.json();
}

// 按 id 读取公告全文（公告弹窗用）。announcements 的 SELECT 策略对所有人开放。
export async function getAnnouncement(
  id: string,
): Promise<{ id: string; title: string; content: string; created_at: string } | null> {
  try {
    const { data, error } = await supabase
      .from('announcements')
      .select('id, title, content, created_at')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as any;
  } catch (error) {
    console.error('获取公告失败:', error);
    return null;
  }
}

// 获取用户的通知
export async function getUserNotifications(userId: string, {
  limit = 20,
  offset = 0,
  onlyUnread = false,
}: {
  limit?: number;
  offset?: number;
  onlyUnread?: boolean;
} = {}) {
  try {
    // 修改查询方式，避免直接使用外键关系
    let query = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (onlyUnread) {
      query = query.eq('is_read', false);
    }
    
    const { data: notifications, error, count } = await query;

    if (error) throw error;
    
    // 批量获取关联数据，避免 N+1 查询
    const notifs = notifications || [];

    // 收集所有需要查询的 ID
    const actorIds = [...new Set(notifs.map(n => n.actor_id).filter(Boolean))];
    const postIds = [...new Set(notifs.map(n => n.post_id).filter(Boolean))];
    const commentIds = [...new Set(notifs.map(n => n.comment_id).filter(Boolean))];

    // 并行批量查询 actor、post、comment
    const [actorsResult, postsResult, commentsResult] = await Promise.all([
      // 批量查询 profiles（user_profiles 表 RLS 限制无法读取，直接用 profiles）
      actorIds.length > 0
        ? supabase.from("profiles").select("id, username, avatar_url").in("id", actorIds)
        : Promise.resolve({ data: [] }),
      // 批量查询 posts
      postIds.length > 0
        ? supabase.from("posts").select("id, title").in("id", postIds)
        : Promise.resolve({ data: [] }),
      // 批量查询 comments
      commentIds.length > 0
        ? supabase.from("comments").select("id, content").in("id", commentIds)
        : Promise.resolve({ data: [] }),
    ]);

    // 构建 actor 映射（基于 profiles 表）
    const actorMap = new Map<string, { username: string; avatar_url: string | null }>();
    for (const profile of actorsResult.data || []) {
      if (profile.username) {
        // 邮箱格式取 @ 前部分
        const username = profile.username.includes('@')
          ? profile.username.split('@')[0]
          : profile.username;
        if (username) {
          actorMap.set(profile.id, {
            username,
            avatar_url: profile.avatar_url || null,
          });
        }
      }
    }

    // 构建 post/comment 映射
    const postMap = new Map<string, { title: string }>();
    for (const post of postsResult.data || []) {
      postMap.set(post.id, { title: post.title });
    }

    const commentMap = new Map<string, { content: string }>();
    for (const comment of commentsResult.data || []) {
      commentMap.set(comment.id, { content: comment.content });
    }

    // 组装最终数据
    const processedNotifications = notifs.map(notification => {
      let actorData = null;

      if (notification.actor_id) {
        const found = actorMap.get(notification.actor_id);
        actorData = found || {
          username: "用户_" + notification.actor_id.substring(0, 6),
          avatar_url: null,
        };

        // 替换消息中的邮箱为用户名
        if (actorData.username && notification.message && notification.message.includes('@')) {
          const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
          notification.message = notification.message.replace(emailPattern, actorData.username);
        }
      }

      return {
        ...notification,
        actor: actorData,
        post: notification.post_id ? postMap.get(notification.post_id) || null : null,
        comment: notification.comment_id ? commentMap.get(notification.comment_id) || null : null,
      };
    });

    return { notifications: processedNotifications, count };
  } catch (error) {
    console.error('获取通知失败:', error);
    return { notifications: [], count: 0 };
  }
}

// 获取未读通知数量
export async function getUnreadNotificationsCount(userId: string) {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    
    if (error) throw error;
    return count || 0;
  } catch (error) {
    console.error('获取未读通知数量失败:', error);
    return 0;
  }
}

// 标记通知为已读
export async function markNotificationAsRead(notificationId: string, userId: string) {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', userId); // 安全检查
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('标记通知已读失败:', error);
    return false;
  }
}

// 标记所有通知为已读
export async function markAllNotificationsAsRead(userId: string) {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);
    
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('标记所有通知已读失败:', error);
    return false;
  }
}

// 使用 Supabase Realtime 实现实时通知
export function subscribeToNotifications(userId: string, callback: (notifications: any[]) => void) {
  console.debug(`为用户 ${userId} 启动实时通知订阅...`);
  
  // 防抖更新函数，避免频繁重新获取
  let updateTimeout: NodeJS.Timeout | null = null;
  
  const fetchAndUpdateNotifications = async () => {
    try {
      const { notifications } = await getUserNotifications(userId);
      console.debug(`已获取到 ${notifications.length} 条通知`);
      callback(notifications);
    } catch (err) {
      console.error('获取通知失败:', err);
    }
  };
  
  // 防抖处理函数，将多个更新合并成一次
  const debouncedUpdate = () => {
    if (updateTimeout) {
      clearTimeout(updateTimeout);
    }
    
    updateTimeout = setTimeout(async () => {
      await fetchAndUpdateNotifications();
    }, 300); // 300ms 防抖时间
  };
  
  // 初始加载数据
  fetchAndUpdateNotifications();
  
  // 创建实时订阅
  const subscription = supabase
    .channel(`notifications-${userId}`)
    .on(
      "postgres_changes",
      {
        event: "*", // 监听所有事件类型（插入、更新、删除）
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`, // 只订阅当前用户的通知
      },
      debouncedUpdate
    )
    .subscribe((status) => {
      console.debug(`通知订阅状态: ${status}`);
      
      // 如果订阅失败，回退到初始加载
      if (status !== 'SUBSCRIBED') {
        console.warn('通知实时订阅失败，回退到基本数据获取');
        fetchAndUpdateNotifications();
      }
    });
  
  // 返回取消订阅的函数
  return () => {
    console.debug('取消通知实时订阅');
    if (updateTimeout) {
      clearTimeout(updateTimeout);
    }
    subscription.unsubscribe();
  };
}

// 改进 likePost 函数，使用智能缓存清理
export async function likePost(postId: string, userId: string) {
  try {
    // 清理相关缓存 - 只清理特定帖子的缓存
    const cacheKey = `${postId}:${userId}`;
    likeStatusCache.delete(cacheKey);
    
    const { data, error } = await supabase
      .from("likes")
      .insert([
        {
          post_id: postId,
          user_id: userId,
          created_at: new Date().toISOString(),
        },
      ])
      .select();

    if (error) {
      throw error;
    }
    
    // 智能清理缓存 - 只清理特定帖子相关的缓存
    smartClearCache('post', postId);
    
    // 获取帖子信息，用于创建通知
    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("user_id, title")
      .eq("id", postId)
      .single();
    
    if (postError) {
      throw postError;
    }
    
    if (post && post.user_id !== userId) {
      // 优先级获取用户名：1. profiles 表 2. auth.users 元数据（user_profiles 对 anon 无读权限已移除）
      let displayUsername = "";
      
      // 1. 优先从 profiles 表获取
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", userId)
          .maybeSingle();
        
        if (profile?.username) {
          displayUsername = profile.username;
        }
      } catch (e) {
        console.error('获取profiles失败:', e);
      }
      
      // 2. 如果 profiles 中没找到，从 auth.users 元数据获取
      if (!displayUsername) {
        try {
          const { data: authUser } = await supabase.auth.getUser(userId);
          if (authUser?.user?.user_metadata?.username) {
            displayUsername = authUser.user.user_metadata.username;
          } else if (authUser?.user?.email) {
            const emailParts = authUser.user.email.split('@');
            displayUsername = emailParts[0];
          }
        } catch (e) {
          console.error('获取auth.user元数据失败:', e);
        }
      }
      
      // 3. 如果都没找到，使用默认
      if (!displayUsername) {
        displayUsername = "用户_" + userId.substring(0, 6);
      }
      
      // 从邮箱中提取用户名部分(例如: one@one.com -> one)
      if (displayUsername.includes('@')) {
        const emailUsername = displayUsername.split('@')[0];
        if (emailUsername) {
          displayUsername = emailUsername;
        }
      }
      
      // 创建通知
      await createNotification({
        userId: post.user_id,
        type: 'like_post',
        postId,
        actorId: userId,
        message: `${displayUsername} 赞了你的帖子 "${post.title}"`,
      });
    } else {
      console.debug('跳过通知创建:', post ? '用户给自己点赞' : '未找到帖子');
    }
    
    return data?.[0];
  } catch (error) {
    console.error("点赞失败:", error);
    throw error;
  }
}

// 更新帖子函数
export async function updatePost({
  postId,
  title,
  content,
  description,
  category,
  image_url,
  image_ratio,
}: {
  postId: string
  title: string
  content: string
  description: string
  category: string
  image_url?: string | null
  image_ratio?: number
}) {
  const timeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('数据库连接超时')), 25000)
  )

  try {
    // 获取用户会话
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
    
    if (sessionError || !sessionData.session) {
      throw new Error("未登录或会话已过期，请重新登录")
    }
    
    const userId = sessionData.session.user.id

    // 验证用户是否有权限编辑此帖子
    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("user_id")
      .eq("id", postId)
      .single()

    if (postError || !post) {
      throw new Error("帖子不存在")
    }

    if (post.user_id !== userId) {
      throw new Error("您没有权限编辑此帖子")
    }

    // 预处理数据
    const safeTitle = title?.trim() || "无标题"
    const safeContent = content?.trim() || "无内容"
    const safeDescription = description?.trim() || ""
    const safeCategory = category?.trim() || "general"
    const safeImageRatio = image_ratio && image_ratio > 0 ? image_ratio : 1.0

    // 更新帖子数据
    const updatePromise = supabase
      .from("posts")
      .update({
        title: safeTitle,
        content: safeContent,
        description: safeDescription,
        category: safeCategory,
        image_url: image_url === null ? null : (image_url || undefined),
        image_ratio: safeImageRatio,
      })
      .eq("id", postId)
      .select()

    const { data, error } = await Promise.race([
      updatePromise,
      timeout
    ]) as any

    if (error) {
      if (error.code === 'PGRST301' || error.message?.includes('timeout')) {
        throw new Error('数据库连接超时，请检查网络连接')
      } else if (error.message?.includes('JWT') || error.message?.includes('auth')) {
        throw new Error('登录已过期，请重新登录')
      } else {
        throw new Error(error.message || '更新失败')
      }
    }

    // 清理缓存
    smartClearCache('post', postId)

    // 触发更新事件
    if (typeof window !== 'undefined' && data && data[0]) {
      const event = new CustomEvent('postUpdated', { 
        detail: { post: data[0] } 
      })
      window.dispatchEvent(event)
    }

    return data
  } catch (error: any) {
    console.error("更新帖子错误:", error)
    throw error
  }
}

// 优化 unlikePost 函数，使用智能缓存清理
export async function unlikePost(postId: string, userId: string) {
  try {
    // 清理相关缓存 - 只清理特定帖子的缓存
    const cacheKey = `${postId}:${userId}`
    likeStatusCache.delete(cacheKey)
    
    const { error } = await supabase
      .from("likes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", userId);

    if (error) throw error;
    
    // 智能清理缓存 - 只清理特定帖子相关的缓存
    smartClearCache('post', postId);
    
    return true;
  } catch (error) {
    console.error("取消点赞失败:", error);
    throw error;
  }
}

// 获取评论点赞数量
export async function getCommentLikesCount(commentId: string) {
  try {
    const { count, error } = await supabase
      .from("comment_likes")
      .select("*", { count: "exact", head: true })
      .eq("comment_id", commentId);
    
    if (error) throw error;
    return count || 0;
  } catch (err) {
    console.error("获取评论点赞数量失败:", err);
    return 0;
  }
}

// 修改 getComments 函数，优化查询效率
export async function getComments(postId: string) {
  try {
    // 首先获取评论
    const { data: comments, error: commentsError } = await supabase
      .from("comments")
      .select(`
        id,
        content,
        created_at,
        user_id,
        parent_id,
        post_id
      `)
      .eq("post_id", postId)
      .order("created_at", { ascending: false });

    if (commentsError) {
      console.error("获取评论错误:", commentsError);
      throw commentsError;
    }

    if (!comments || comments.length === 0) {
      return [];
    }

    // 收集评论ID和用户ID用于批量查询
    const commentIds = comments.map(comment => comment.id);
    const userIds = [...new Set(comments.map(c => c.user_id).filter(Boolean))];
    
    // 并行执行批量查询
    const [commentLikesPromise, usersMapPromise] = await Promise.all([
      // 1. 批量查询评论点赞 - 获取每个评论的点赞数量
      Promise.all(commentIds.map(async (commentId) => {
        const { count } = await supabase
          .from("comment_likes")
          .select("*", { count: "exact", head: true })
          .eq("comment_id", commentId);
        return { commentId, likes: count || 0 };
      })),
      
      // 2. 批量查询用户信息（从 profiles 表，user_profiles 对 anon 无权限已移除）
      (async () => {
        const usersMap = new Map();
        
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, username, avatar_url")
          .in("id", userIds);
        
        if (profiles) {
          profiles.forEach(profile => {
            usersMap.set(profile.id, {
              id: profile.id,
              username: profile.username || "匿名用户",
              avatar_url: profile.avatar_url
            });
          });
        }
        
        // 对于没有找到的用户，设置默认值
        userIds.forEach(userId => {
          if (!usersMap.has(userId)) {
            usersMap.set(userId, {
              id: userId,
              username: `用户_${userId.substring(0, 6)}`,
              avatar_url: null
            });
          }
        });
        
        return usersMap;
      })()
    ]);
    
    // 构建点赞数映射
    const likesMap = new Map();
    commentLikesPromise.forEach(item => {
      likesMap.set(item.commentId, item.likes);
    });
    
    // 使用批量获取的数据处理评论
    const processedComments = comments.map(comment => {
      const userInfo = usersMapPromise.get(comment.user_id);
      return { 
        ...comment, 
        username: userInfo?.username || "匿名用户",
        user: userInfo || {
          id: comment.user_id,
          username: "匿名用户",
          avatar_url: null
        },
        likes_count: likesMap.get(comment.id) || 0,
        likes: likesMap.get(comment.id) || 0  // 兼容两种字段名
      };
    });
    
    // 组装评论为树状结构
    function buildCommentTree(flatComments: any[]): Comment[] {
      const map = new Map<string, Comment & { replies: Comment[] }>();
      const roots: Comment[] = [];

      flatComments.forEach((comment: any) => {
        map.set(comment.id, { ...comment, replies: [] });
      });

      map.forEach((comment) => {
        if (comment.parent_id) {
          const parent = map.get(comment.parent_id);
          if (parent) {
            parent.replies.push(comment);
          } else {
            // 找不到父评论，作为根评论处理
            roots.push(comment);
          }
        } else {
          roots.push(comment);
        }
      });

      return roots;
    }

    return buildCommentTree(processedComments);
  } catch (error) {
    console.error("获取评论失败:", error);
    throw error;
  }
}

// 修改addComment函数，添加通知创建逻辑
export async function addComment(postId: string, userId: string, content: string, parentId?: string) {
  try {
    const { data, error } = await supabase
      .from("comments")
      .insert([
        {
          post_id: postId,
          user_id: userId,
          content,
          parent_id: parentId || null,
          created_at: new Date().toISOString(),
        },
      ])
      .select(`
        id,
        content,
        created_at,
        user_id,
        parent_id,
        post_id
      `)
      .single();

    if (error) {
      throw error;
    }
    
    // 获取用户信息
    const { data: userInfo } = await supabase
      .from("profiles")
      .select("username, avatar_url")
      .eq("id", userId)
      .maybeSingle();
    
    const formattedComment = {
      ...data,
      username: userInfo?.username || "匿名用户",
      user: userInfo ? {
        id: userId,
        username: userInfo.username || "匿名用户",
        avatar_url: userInfo.avatar_url
      } : null,
      replies: [],
      likes_count: 0
    }
    
    // 创建评论通知
    // 优先级获取用户名：1. userInfo（已从 profiles 查过）2. auth.users 元数据
    let displayUsername = "";
    
    // 1. 优先用上面已查过的 profiles
    if (userInfo?.username) {
      displayUsername = userInfo.username;
    }
    
    // 2. 如果 profiles 中没找到，从 auth.users 元数据获取
    if (!displayUsername) {
      try {
        const { data: authUser } = await supabase.auth.getUser(userId);
        if (authUser?.user?.user_metadata?.username) {
          displayUsername = authUser.user.user_metadata.username;
        }
      } catch (e) {
        // 静默忽略错误
      }
    }
    
    // 3. 如果所有来源都没找到，使用默认
    if (!displayUsername) {
      displayUsername = "用户_" + userId.substring(0, 6);
    }
    
    // 从邮箱中提取用户名部分(例如: one@one.com -> one)
    if (displayUsername.includes('@')) {
      const emailUsername = displayUsername.split('@')[0];
      if (emailUsername) {
        displayUsername = emailUsername;
      }
    }
    
    if (parentId) {
      // 如果是回复评论，通知被回复的评论作者
      const { data: parentComment } = await supabase
        .from("comments")
        .select("user_id")
        .eq("id", parentId)
        .single();
      
      if (parentComment && parentComment.user_id !== userId) {
        await createNotification({
          userId: parentComment.user_id,
          type: 'comment_post',
          postId,
          actorId: userId,
          message: `${displayUsername} 回复了你的评论: "${content.substring(0, 30)}${content.length > 30 ? '...' : ''}"`,
        });
      }
    } else {
      // 如果是直接评论帖子，通知帖子作者
      const { data: post } = await supabase
        .from("posts")
        .select("user_id, title")
        .eq("id", postId)
        .maybeSingle();
      
      if (post && post.user_id !== userId) {
        await createNotification({
          userId: post.user_id,
          type: 'comment_post',
          postId,
          actorId: userId,
          message: `${displayUsername} 评论了你的帖子 "${post.title}": "${content.substring(0, 30)}${content.length > 30 ? '...' : ''}"`,
        });
      }
    }
    
    return formattedComment;
  } catch (error) {
    console.error("添加评论失败:", error);
    throw error;
  }
}

// 实时订阅帖子更新
export function subscribeToPostsUpdates(callback: (posts: any[]) => void) {
  // 初始加载帖子
  getPosts().then(callback).catch(console.error)

  // 订阅帖子表的变化
  const subscription = supabase
    .channel("posts-channel")
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, async (payload) => {
      // 当有变化时，重新获取所有帖子
      try {
        const posts = await getPosts()
        callback(posts)
      } catch (error) {
        console.error("获取更新的帖子失败:", error)
      }
    })
    .subscribe()

  // 返回取消订阅的函数
  return () => {
    subscription.unsubscribe()
  }
}

// 实时订阅评论更新
export function subscribeToCommentsUpdates(postId: string, callback: (comments: Comment[]) => void) {
  // 初始加载评论
  getComments(postId).then(callback).catch(console.error)

  // 订阅特定帖子的评论变化
  const subscription = supabase
    .channel(`comments-channel-${postId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "comments",
        filter: `post_id=eq.${postId}`,
      },
      async (payload) => {
        // 当有变化时，重新获取该帖子的所有评论
        try {
          const comments = await getComments(postId)
          callback(comments)
        } catch (error) {
          console.error("获取更新的评论失败:", error)
        }
      },
    )
    .subscribe()

  // 返回取消订阅的函数
  return () => {
    subscription.unsubscribe()
  }
}

// 添加一个函数来创建必要的RPC函数
export async function setupRpcFunctions() {
  // 检查increment函数是否存在
  try {
    // 尝试调用increment函数，如果不存在会抛出错误
    const { data: incrementTest, error: incrementError } = await supabase.rpc("increment", { x: 1 })
    if (incrementError && incrementError.message?.includes("does not exist")) {
      console.log("increment函数不存在，需要在数据库中手动创建")
    }
  } catch (e) {
    console.error("检查increment函数时出错:", e)
  }

  // 检查decrement函数是否存在
  try {
    // 尝试调用decrement函数，如果不存在会抛出错误
    const { data: decrementTest, error: decrementError } = await supabase.rpc("decrement", { x: 1 })
    if (decrementError && decrementError.message?.includes("does not exist")) {
      console.log("decrement函数不存在，需要在数据库中手动创建")
    }
  } catch (e) {
    console.error("检查decrement函数时出错:", e)
  }

  // 检查get_table_info函数是否存在
  try {
    // 尝试调用get_table_info函数，如果不存在会抛出错误
    const { data: tableInfo, error: tableError } = await supabase.rpc("get_table_info", { table_name: "posts" })
    if (tableError && tableError.message?.includes("does not exist")) {
      console.log("get_table_info函数不存在，需要在数据库中手动创建")
    }
  } catch (e) {
    console.error("检查get_table_info函数时出错:", e)
  }
}

// 清理所有相关缓存的函数
export function clearCaches() {
  // 使用智能缓存清理代替直接清理所有缓存
  smartClearCache('all');
  
  // 以下为旧版逻辑，保留注释以便理解原始实现
  // 清理点赞状态缓存
  // likeStatusCache.clear();
  
  // 清理用户资料缓存
  // profileCache.clear();

  // 清理帖子和评论相关的缓存（如果它们也被缓存的话）
  // 示例:
  // postCache.clear();
  // commentsCache.clear();
}

// 获取某个帖子的点赞数 - 实时从likes表计算
export async function getLikesCount(postId: string) {
  const { count, error } = await supabase
    .from("likes")
    .select("*", { count: "exact", head: true })
    .eq("post_id", postId);
  if (error) throw error;
  return count || 0;
}

// 简化删除帖子函数 - 弃用，改用lib/post-delete-fix.ts中的函数
export async function deletePost(postId: string) {
  console.warn("此函数已弃用，请使用 lib/post-delete-fix.ts 中的 deletePostWithUIUpdate 函数");
  
  try {
    // 转发到正确的实现
    const { deletePostWithUIUpdate } = await import('./post-delete-fix');
    return await deletePostWithUIUpdate(postId);
  } catch (error) {
    console.error("删除帖子失败:", error);
    throw error;
  }
}

// 检查用户是否已点赞评论
export async function checkCommentLiked(commentId: string, userId: string) {
  if (!userId || !commentId) return false;
  
  try {
    // 使用缓存键 comment:commentId:userId
    const cacheKey = `comment:${commentId}:${userId}`;
    
    // 检查缓存状态
    if (likeStatusCache.has(cacheKey)) {
      return likeStatusCache.get(cacheKey);
    }
    
    const { data, error } = await supabase
      .from("comment_likes")
      .select("id")
      .eq("comment_id", commentId)
      .eq("user_id", userId)
      .maybeSingle();

    const isLiked = !!data;
    
    // 更新缓存
    likeStatusCache.set(cacheKey, isLiked);
    
    return isLiked;
  } catch (e) {
    console.error("检查评论点赞状态异常:", e)
    return false;
  }
}

// 优化 likeComment 函数，使用智能缓存清理
export async function likeComment(commentId: string, userId: string) {
  try {
    // 清理相关缓存 - 只清理特定评论的缓存
    const cacheKey = `comment:${commentId}:${userId}`;
    likeStatusCache.delete(cacheKey);
    
    const { data, error } = await supabase
      .from("comment_likes")
      .insert([
        {
          comment_id: commentId,
          user_id: userId,
          created_at: new Date().toISOString(),
        },
      ])
      .select();

    if (error) throw error;
    
    // 智能清理缓存 - 只清理特定评论相关的缓存
    smartClearCache('comment', commentId);
    
    // 获取评论信息，用于创建通知
    const { data: comment } = await supabase
      .from("comments")
      .select("user_id, content, post_id")
      .eq("id", commentId)
      .single();
    
    if (comment && comment.user_id !== userId) {
      // 优先级获取用户名：1.user_profiles表 2.auth.users元数据 3.profiles表
      let displayUsername = "";
      
      // 1. 优先从 profiles 表获取用户名（user_profiles 对 anon 无读权限已移除）
      try {
        const { data: userData } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", userId)
          .maybeSingle();
        
        if (userData?.username) {
          displayUsername = userData.username;
        }
      } catch (e) {
        // 静默忽略错误
      }
      
      // 2. 如果 profiles 中没找到，从 auth.users 元数据获取
      if (!displayUsername) {
        try {
          const { data: authUser } = await supabase.auth.getUser(userId);
          if (authUser?.user?.user_metadata?.username) {
            displayUsername = authUser.user.user_metadata.username;
          }
        } catch (e) {
          // 静默忽略错误
        }
      }
      
      // 3. 如果所有来源都没找到，使用默认
      if (!displayUsername) {
        displayUsername = "用户_" + userId.substring(0, 6);
      }
      
      // 从邮箱中提取用户名部分(例如: one@one.com -> one)
      if (displayUsername.includes('@')) {
        const emailUsername = displayUsername.split('@')[0];
        if (emailUsername) {
          displayUsername = emailUsername;
        }
      }
      
      const commentPreview = comment.content.substring(0, 20) + (comment.content.length > 20 ? "..." : "");
      
      // 创建通知
      await createNotification({
        userId: comment.user_id,
        type: 'like_comment',
        commentId,
        postId: comment.post_id,
        actorId: userId,
        message: `${displayUsername} 赞了你的评论: "${commentPreview}"`,
      });
    }
    
    return data?.[0];
  } catch (error) {
    console.error("评论点赞失败:", error);
    throw error;
  }
}

// 优化 unlikeComment 函数，使用智能缓存清理
export async function unlikeComment(commentId: string, userId: string) {
  try {
    // 清理相关缓存 - 只清理特定评论的缓存
    const cacheKey = `comment:${commentId}:${userId}`;
    likeStatusCache.delete(cacheKey);
    
    const { error } = await supabase
      .from("comment_likes")
      .delete()
      .eq("comment_id", commentId)
      .eq("user_id", userId);

    if (error) throw error;
    
    // 智能清理缓存 - 只清理特定评论相关的缓存
    smartClearCache('comment', commentId);
    
    return true;
  } catch (error) {
    console.error("取消评论点赞失败:", error);
    throw error;
  }
} 