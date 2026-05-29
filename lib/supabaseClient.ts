// lib/supabaseClient.ts
import { createClient } from "@supabase/supabase-js"

// Supabase客户端配置

// 确保环境变量存在且正确
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""

// 检查环境变量是否为空
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("⚠️ Supabase环境变量未设置或为空! URL:", supabaseUrl ? "已设置" : "未设置", "Key:", supabaseAnonKey ? "已设置" : "未设置");
  throw new Error("Supabase环境变量未设置或为空，请检查您的.env.local文件")
}

// 解析URL以获取信息用于诊断
function getDomainInfo(url: string) {
  try {
    const parsedUrl = new URL(url);
    return {
      url: parsedUrl.origin,
      protocol: parsedUrl.protocol.replace(':', ''),
      isHTTPS: parsedUrl.protocol === 'https:',
      isIP: /^(\d{1,3}\.){3}\d{1,3}$/.test(parsedUrl.hostname),
      isDomain: parsedUrl.hostname.includes('.'),
      isHTTPDomain: parsedUrl.hostname.includes('.') && parsedUrl.protocol === 'http:',
      isReverseProxy: false,
      useHTTPOnly: false,
      isApp: typeof window !== 'undefined' && /capacitor|cordova|android/i.test(navigator.userAgent),
      host: parsedUrl.hostname,
      origin: typeof window !== 'undefined' ? window.location.origin : null
    };
  } catch (e) {
    return {
      url,
      protocol: 'unknown',
      isHTTPS: false,
      isIP: false,
      isDomain: false,
      isHTTPDomain: false,
      isReverseProxy: false,
      useHTTPOnly: false,
      isApp: false,
      host: 'unknown',
      origin: null
    };
  }
}

// 打印连接信息用于诊断
const connectionInfo = getDomainInfo(supabaseUrl);
console.debug("🔧 Supabase客户端初始化:", connectionInfo);

// 创建Supabase客户端 - 增强实时功能配置
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "supabase.auth.token",
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
    // 增加实时功能超时配置
    timeout: 30000, // 30秒超时
  },
  global: {
    fetch: (...args) => {
      // 自定义fetch，添加超时处理
      const [url, options] = args
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 增加到30秒超时

      return fetch(url as string, {
        ...(options as RequestInit),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId))
    },
  },
})

// 连接状态检查函数
export async function testConnection() {
  try {
    console.debug("🔄 测试Supabase连接...");
    const startTime = Date.now()
    const { data, error } = await supabase.from("posts").select("id").limit(1)
    const endTime = Date.now()

    if (error) {
      console.error("❌ Supabase连接测试失败:", error);
      return { success: false, error, latency: endTime - startTime }
    }

    const latency = endTime - startTime;
    console.debug(`✅ Supabase连接成功! 延迟: ${latency}ms, 返回数据:`, data);
    return { success: true, latency, data }
  } catch (err) {
    console.error("🔥 Supabase连接测试异常:", err);
    return { success: false, error: err }
  }
}

// 注：diagnoseTables 函数已移除（无人调用，且依赖 user_profiles 表被 RLS 拦截）

// 检查用户是否是管理员
export async function checkIsAdmin(userId: string): Promise<boolean> {
  if (!userId) return false

  try {
    // 硬编码管理员ID，确保管理员功能正常工作
    if (userId === "4345c6d0-05eb-4bc3-ba50-1cfa1dee2c41") {
      return true
    }

    // 使用简单查询，避免复杂关系
    const { data, error } = await supabase
      .from("admin_users")
      .select("id") // 只选择ID字段，避免关联查询
      .eq("user_id", userId)
      .maybeSingle() // 使用maybeSingle代替single，避免404错误

    if (error) {
      return false
    }

    return !!data // 如果data存在，则用户是管理员
  } catch (err) {
    return false
  }
}

// 添加删除帖子的函数 - 简化版本，避免服务器错误
export async function deletePost(postId: string) {
  try {
    // 获取用户会话
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

    if (sessionError) {
      throw new Error("认证错误: " + sessionError.message)
    }

    if (!sessionData.session) {
      throw new Error("未认证: 无活跃会话")
    }

    const userId = sessionData.session.user.id

    // 检查用户是否是管理员
    const isAdmin = await checkIsAdmin(userId)

    // 检查帖子是否存在
    const { data: postData, error: postError } = await supabase
      .from("posts")
      .select("id, user_id")
      .eq("id", postId)
      .maybeSingle()

    if (postError) {
      throw new Error("帖子不存在或无法访问")
    }

    if (!postData) {
      throw new Error("帖子不存在")
    }

    // 检查用户是否是帖子作者或管理员
    if (!isAdmin && postData.user_id !== userId) {
      throw new Error("您没有权限删除此帖子")
    }

    // 删除帖子相关的评论
    const { error: commentsError } = await supabase.from("comments").delete().eq("post_id", postId)

    if (commentsError) {
      // 继续执行，不中断流程
    }

    // 删除帖子相关的点赞
    const { error: likesError } = await supabase.from("likes").delete().eq("post_id", postId)

    if (likesError) {
      // 继续执行，不中断流程
    }

    // 删除帖子
    const { error: deleteError } = await supabase.from("posts").delete().eq("id", postId)

    if (deleteError) {
      throw deleteError
    }

    return { success: true }
  } catch (err) {
    throw err
  }
}

// 检查认证状态
export async function checkAuth() {
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) {
      return false
    }
    return !!data.session
  } catch (err) {
    return false
  }
}
