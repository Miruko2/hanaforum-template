"use client"

import React, { createContext, useContext, useState, useEffect } from "react"
import { supabase } from "@/lib/supabaseClient"
import type { User } from "@supabase/supabase-js"
import { useToast } from "@/hooks/use-toast"
import { resetCollectionsStore } from "@/lib/collections"

interface SimpleAuthContextType {
  user: User | null
  isAdmin: boolean
  // 当前账号是否被封禁（账号级全站封锁，由 BannedGate 据此整屏接管）
  isBanned: boolean
  banReason: string
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: any }>
  signUp: (email: string, password: string, username: string) => Promise<{ error: any; data: any }>
  signOut: () => Promise<void>
}

const SimpleAuthContext = createContext<SimpleAuthContextType>({
  user: null,
  isAdmin: false,
  isBanned: false,
  banReason: "",
  loading: true,
  signIn: async () => ({ error: null }),
  signUp: async () => ({ error: null, data: null }),
  signOut: async () => {},
})

export const useSimpleAuth = () => useContext(SimpleAuthContext)

// 管理员ID列表 - 与数据库 admin_users 表保持一致
// 通过环境变量 NEXT_PUBLIC_ADMIN_USER_IDS 配置（逗号分隔，支持多个管理员）
const ADMIN_IDS = (process.env.NEXT_PUBLIC_ADMIN_USER_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

export const SimpleAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isBanned, setIsBanned] = useState(false)
  const [banReason, setBanReason] = useState("")
  const { toast } = useToast()

  // 简化的管理员检查
  const isAdmin = user ? ADMIN_IDS.includes(user.id) : false

  // 账号封禁检查：登录后查 banned_users（RLS select-self 只能查到自己），
  // 并订阅 realtime —— 管理员封禁/解封即时生效（无需用户刷新）。
  // 表未建/查询异常按“未封禁”处理，不误锁正常用户（真正写入拦截在 RLS/RPC 层）。
  useEffect(() => {
    if (!user) {
      setIsBanned(false)
      setBanReason("")
      return
    }
    let alive = true
    const apply = (row: { reason?: string | null; expires_at?: string | null } | null) => {
      if (!alive) return
      if (!row) {
        setIsBanned(false)
        setBanReason("")
        return
      }
      const active = !row.expires_at || new Date(row.expires_at) > new Date()
      setIsBanned(active)
      setBanReason(active ? row.reason || "" : "")
    }
    const fetchBan = async () => {
      const { data, error } = await supabase
        .from("banned_users")
        .select("reason, expires_at")
        .eq("user_id", user.id)
        .maybeSingle()
      if (error) {
        apply(null)
        return
      }
      apply(data as any)
    }
    fetchBan()
    const channel = supabase
      .channel(`ban_watch_${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "banned_users", filter: `user_id=eq.${user.id}` },
        () => {
          fetchBan()
        },
      )
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
  }, [user])

  // 初始化：获取当前会话
  useEffect(() => {
    let mounted = true

    const initializeAuth = async () => {
      try {
        console.debug('🔄 SimpleAuth: 初始化认证...')
        
        const { data: { session }, error } = await supabase.auth.getSession()
        
        if (error) {
          console.error('❌ SimpleAuth: 获取会话失败:', error.message)
        }
        
        if (mounted) {
          if (session?.user) {
            console.debug('✅ SimpleAuth: 找到有效会话:', session.user.email)
            setUser(session.user)
          } else {
            console.debug('ℹ️ SimpleAuth: 无有效会话')
            setUser(null)
          }
          setLoading(false)
        }
      } catch (err: any) {
        console.error('💥 SimpleAuth: 初始化失败:', err.message)
        if (mounted) {
          setUser(null)
          setLoading(false)
        }
      }
    }

    // 更短的超时时间，1秒
    const timeoutId = setTimeout(() => {
      if (mounted && loading) {
        console.warn('⚠️ SimpleAuth: 初始化超时，强制结束loading状态')
        setLoading(false)
      }
    }, 1000) // 1秒超时

    // 立即开始初始化
    initializeAuth().finally(() => {
      clearTimeout(timeoutId)
    })

    return () => {
      mounted = false
      clearTimeout(timeoutId)
    }
  }, [])

  // 监听认证状态变化
  useEffect(() => {
    console.debug('🔄 SimpleAuth: 设置认证状态监听器')
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.debug('🔄 SimpleAuth: 认证状态变化:', event, session?.user?.email)
        
        if (session?.user) {
          setUser(session.user)
        } else {
          setUser(null)
          // 登出/会话失效：清空收藏单点 store，避免残留上个账号的收藏标记
          resetCollectionsStore()
        }

        // 确保loading状态在状态变化时被清除
        setLoading(false)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    try {
      console.debug('🔐 SimpleAuth: 尝试登录:', email)
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        console.error('❌ SimpleAuth: 登录失败:', error.message)
        toast({
          title: "登录失败",
          description: error.message,
          variant: "destructive",
        })
        return { error }
      }

      if (data.session?.user) {
        console.debug('✅ SimpleAuth: 登录成功:', data.user.email)
        // 状态会通过onAuthStateChange自动更新
        toast({
          title: "登录成功",
          description: "欢迎回来！",
        })
      }

      return { error: null }
    } catch (error: any) {
      console.error('💥 SimpleAuth: 登录异常:', error.message)
      toast({
        title: "登录失败",
        description: error.message || "登录过程中发生错误",
        variant: "destructive",
      })
      return { error }
    }
  }

  const signUp = async (email: string, password: string, username: string) => {
    try {
      console.debug('🔐 SimpleAuth: 尝试注册:', email, '用户名:', username)
      
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username, // 保存用户名到元数据
          },
        },
      })

      if (error) {
        console.error('❌ SimpleAuth: 注册失败:', error.message)
        toast({
          title: "注册失败",
          description: error.message,
          variant: "destructive",
        })
        return { error, data: null }
      }

      if (!data.user) {
        console.warn('⚠️ SimpleAuth: 注册成功但未返回用户数据');
        return { error: null, data }
      }
      
      console.debug('✅ SimpleAuth: 注册成功，用户ID:', data.user.id);
      
      // 创建用户资料 - 首先创建user_profiles表记录，这是显示用户名的主要来源
      try {
        console.debug('📊 SimpleAuth: 创建user_profiles记录...');
        const { data: userProfileData, error: userProfileError } = await supabase
          .from("user_profiles")
          .insert([
            {
              user_id: data.user.id,
              username, // 保存用户名
            },
          ])
          .select()
          .single();
        
        if (userProfileError) {
          console.error('❌ SimpleAuth: 创建user_profiles记录失败:', userProfileError.message);
          // 继续执行，不中断流程
        } else {
          console.debug('✅ SimpleAuth: 成功创建user_profiles记录:', userProfileData);
        }
      } catch (e) {
        console.error('❌ SimpleAuth: 创建user_profiles异常:', e);
        // 继续执行，不中断流程
      }

      // 然后创建profiles记录（为兼容现有代码）
      try {
        console.debug('📊 SimpleAuth: 创建profiles记录...');
        const { data: profileData, error: profileError } = await supabase
          .from("profiles")
          .insert([
            {
              id: data.user.id,
              username, // 保存用户名
              updated_at: new Date().toISOString()
            },
          ])
          .select()
          .single();
          
        if (profileError) {
          console.error('❌ SimpleAuth: 创建profiles记录失败:', profileError.message);
          // 继续执行，不中断流程
        } else {
          console.debug('✅ SimpleAuth: 成功创建profiles记录:', profileData);
        }
      } catch (e) {
        console.error('❌ SimpleAuth: 创建profiles异常:', e);
        // 继续执行，不中断流程
      }

      // 最后检查是否需要更新auth.users元数据（确保冗余存储用户名）
      try {
        // 使用更新方法直接更新用户元数据
        const { error: updateError } = await supabase.auth.updateUser({
          data: { username, displayName: username }
        });
        
        if (updateError) {
          console.warn('⚠️ SimpleAuth: 更新用户元数据失败:', updateError.message);
        } else {
          console.debug('✅ SimpleAuth: 用户元数据更新成功');
        }
      } catch (e) {
        console.error('❌ SimpleAuth: 更新用户元数据异常:', e);
      }

      console.debug('✅ SimpleAuth: 注册完成，用户:', data.user.email, '用户名:', username);
      // 邮箱验证已关闭：注册即自动登录，不再发验证邮件。
      toast({
        title: "注册成功",
        description: "欢迎加入萤火虫之国！",
      })
      return { data, error: null }
    } catch (error: any) {
      console.error('💥 SimpleAuth: 注册异常:', error.message)
      toast({
        title: "注册失败",
        description: error.message || "注册过程中发生错误",
        variant: "destructive",
      })
      return { error, data: null }
    }
  }

  const signOut = async () => {
    try {
      console.debug('🔒 SimpleAuth: 执行退出登录')
      
      // 立即更新状态
      setUser(null)
      
      // 执行Supabase登出
      const { error } = await supabase.auth.signOut()
      
      if (error) {
        console.error('❌ SimpleAuth: 登出失败:', error.message)
      } else {
        console.debug('✅ SimpleAuth: 登出成功')
      }
      
      // 清除本地存储的认证数据 - 更全面的清理
      if (typeof window !== 'undefined') {
        // 更完整的认证键列表
        const authKeys = [
          // 标准Supabase键
          'sb-session', 'sb-https-session',
          'sb-auth-token', 'sb-https-auth-token',
          'supabase.auth.token', 'supabase:auth:token',
          
          // 备份和自定义键
          'auth-session', 'auth-user',
          'session-data', 'user-data'
        ]
        
        // 清除localStorage和sessionStorage
        authKeys.forEach(key => {
          try {
            localStorage.removeItem(key)
            sessionStorage.removeItem(key)
          } catch (e) {
            console.warn(`清除键${key}失败:`, e)
          }
        })
        
        // 清除可能存在的认证相关cookie
        try {
          const cookies = document.cookie.split(';')
          for (const cookie of cookies) {
            const cookieName = cookie.split('=')[0].trim()
            if (cookieName.includes('sb-') || 
                cookieName.includes('supabase') || 
                cookieName.includes('auth')) {
              document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`
            }
          }
        } catch (e) {
          console.warn('清除cookie失败:', e)
        }
      }
      
      // 使用延迟确保操作完成
      await new Promise(resolve => setTimeout(resolve, 100))
      
      toast({
        title: "已退出登录",
        description: "您已成功退出登录",
      })
    } catch (error: any) {
      console.error('💥 SimpleAuth: 登出异常:', error.message)
      // 即使出错也要清除用户状态
      setUser(null)
    }
  }

  const value = {
    user,
    isAdmin,
    isBanned,
    banReason,
    loading,
    signIn,
    signUp,
    signOut,
  }

  return (
    <SimpleAuthContext.Provider value={value}>
      {children}
    </SimpleAuthContext.Provider>
  )
} 