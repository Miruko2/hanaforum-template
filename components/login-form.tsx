"use client"

import type React from "react"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabaseClient"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { LoadingAnimation } from "./ui/loading-animation"
import { usePosts } from "@/contexts/posts-context" // 添加引入usePosts

export default function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const { signIn } = useSimpleAuth()
  const { toast } = useToast()
  const { loadPosts, retryLoading } = usePosts() // 获取帖子加载方法

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!email || !password) {
      setError("请填写所有必填字段")
      return
    }

    try {
      setIsLoading(true)
      console.debug('🔐 LoginForm: 开始登录流程...')
      
      const { error } = await signIn(email, password)

      if (error) {
        console.error('❌ LoginForm: 登录失败:', error.message)
        setError(error.message || "登录失败，请检查您的凭据")
      } else {
        console.debug('✅ LoginForm: 登录成功')
        
        // 登录成功后，等待一下让会话状态同步
        await new Promise(resolve => setTimeout(resolve, 500))
        
        // 检查session状态
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
        
        if (sessionError) {
          console.error('❌ LoginForm: 会话检查失败:', sessionError.message)
        } else if (sessionData?.session) {
          console.debug('✅ LoginForm: 会话验证成功:', sessionData.session.user.id)
          
          // 成功消息
          toast({
            title: "登录成功",
            description: "正在跳转...",
          })
          
          // 简化登录后的处理：直接刷新页面到首页
          // 这样可以确保所有状态都是干净的，避免任何缓存或状态问题
          console.debug('🔄 登录成功: 刷新页面到首页');
          window.location.href = '/';
        } else {
          console.warn('⚠️ LoginForm: 登录成功但会话为空')
          // 如果没有会话，保持在登录页面，给用户反馈
          toast({
            title: "登录状态异常",
            description: "请稍后再试",
            variant: "destructive",
          })
        }
      }
    } catch (err: any) {
      console.error('💥 LoginForm: 登录异常:', err.message)
      setError(err.message || "登录过程中发生错误")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm space-y-6 p-4">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-bold text-lime-400">欢迎回来</h1>
        <p className="text-gray-400">请登录您的账号</p>
      </div>
      <form id="login-form" onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="p-3 rounded-md bg-red-900/30 text-red-400 text-sm">{error}</div>}

        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bg-gray-800/50 border-gray-700 focus:border-lime-500 text-white"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">密码</Label>
            <Link href="/forgot-password" className="text-xs text-lime-400 hover:text-lime-300">
              忘记密码?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="bg-gray-800/50 border-gray-700 focus:border-lime-500 text-white"
          />
        </div>
        <Button
          type="submit"
          className={cn("w-full bg-lime-600 hover:bg-lime-700 text-white")}
          disabled={isLoading}
        >
          {isLoading ? (
            <span className="flex items-center">
              <LoadingAnimation size="sm" color="text-background" />
              <span className="ml-2">登录中...</span>
            </span>
          ) : "登录"}
        </Button>
      </form>
      <div className="text-center text-sm">
        <span className="text-gray-400">还没有账号? </span>
        <Link href="/register" className="text-lime-400 hover:text-lime-300">
          立即注册
        </Link>
      </div>
    </div>
  )
}