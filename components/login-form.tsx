"use client"

import type React from "react"

import { useState, useEffect, useMemo } from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabaseClient"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { LoadingAnimation } from "./ui/loading-animation"
import { DotMatrixInput } from "@/components/auth/dot-matrix-input"
import { getRecentAccounts, matchAccount, rememberAccount, type RecentAccount } from "@/lib/recent-accounts"

export default function LoginForm({ onSuccess }: { onSuccess?: () => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { signIn } = useSimpleAuth()
  const { toast } = useToast()

  // 本机登录过的账号（仅 localStorage）。输入的邮箱命中时，邮箱框点阵替换为该账号头像。
  const [recents, setRecents] = useState<RecentAccount[]>([])
  useEffect(() => {
    setRecents(getRecentAccounts())
  }, [])
  const matched = useMemo(() => matchAccount(recents, email), [recents, email])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    // 登录成功后会触发卡片消散过渡并跳转；其间保持 loading 态，故标记「正在跳转」。
    let navigatingAway = false

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

          // 记住本机账号（邮箱 + 头像），下次在登录页输入该邮箱即可「欢迎回来」显示头像。
          // 仅写本机 localStorage，失败不阻断跳转。
          try {
            const sUser = sessionData.session.user
            const { data: prof } = await supabase
              .from("profiles")
              .select("avatar_url, username")
              .eq("id", sUser.id)
              .single()
            rememberAccount(sUser.email || email, prof?.avatar_url ?? null, prof?.username ?? null)
          } catch {
            // 记不住就降级为「不出头像」，不影响登录
          }

          // 登录成功：交给外层 LoginCard 播放「卡片高斯模糊消散」过渡后再跳转首页；
          // 无 onSuccess（独立使用本组件时）则退化为原来的直接硬跳转。
          // 跳转仍走整页刷新，确保 auth / posts 等上下文以干净状态重新挂载。
          navigatingAway = true
          console.debug('🔄 登录成功: 启动登录卡片消散过渡 → 首页');
          if (onSuccess) {
            onSuccess()
          } else {
            window.location.href = '/';
          }
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
      // 跳转中（消散过渡进行时）保持按钮 loading 态，避免「登录中…→登录」文字回跳闪烁。
      if (!navigatingAway) setIsLoading(false)
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

        <DotMatrixInput
          label="邮箱"
          value={email}
          onChange={setEmail}
          type="email"
          placeholderWord="MAIL"
          inputMode="email"
          autoComplete="email"
          showCaption
          autoFocus
          avatarUrl={matched?.avatarUrl ?? null}
          avatarAlt={matched?.username ?? undefined}
        />
        <DotMatrixInput
          label="密码"
          value={password}
          onChange={setPassword}
          type="password"
          placeholderWord="PASS"
          autoComplete="current-password"
          labelExtra={
            <Link href="/forgot-password" className="text-xs text-lime-400 hover:text-lime-300">
              忘记密码?
            </Link>
          }
        />
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
