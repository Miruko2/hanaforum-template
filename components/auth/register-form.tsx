// components/auth/register-form.tsx
"use client"

import type React from "react"

import { useState } from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { Button } from "@/components/ui/button"
import { DotMatrixInput } from "@/components/auth/dot-matrix-input"

export function RegisterForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const { signUp } = useSimpleAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      // 注册用户，并将用户名添加到用户元数据中
      const { error: signUpError } = await signUp(email, password, username)

      if (signUpError) {
        setError(signUpError.message || "注册失败")
        return
      }

      // 邮箱验证已关闭：注册成功即自动登录。
      // 等会话写入 localStorage 后整页跳首页，确保首页能读到登录态（与登录流程一致）。
      await new Promise((resolve) => setTimeout(resolve, 500))
      window.location.href = "/"
    } catch (err: any) {
      console.error("注册错误:", err)
      setError(err.message || "注册失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-md mx-auto p-8 rounded-2xl
      bg-black/20 backdrop-blur-lg border border-white/10 shadow-2xl
      transition-all duration-300">
      <h2 className="text-2xl font-bold text-center text-lime-400 mb-6">注册</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="p-3 rounded-md bg-red-900/30 text-red-400 text-sm">{error}</div>}

        <DotMatrixInput
          label="用户名"
          value={username}
          onChange={setUsername}
          type="text"
          placeholderWord="USER"
          autoComplete="username"
          showCaption
          autoFocus
        />
        <DotMatrixInput
          label="邮箱"
          value={email}
          onChange={setEmail}
          type="email"
          placeholderWord="MAIL"
          inputMode="email"
          autoComplete="email"
          showCaption
        />
        <DotMatrixInput
          label="密码"
          value={password}
          onChange={setPassword}
          type="password"
          placeholderWord="PASS"
          autoComplete="new-password"
        />

        <Button type="submit" disabled={loading} className="w-full bg-lime-500 hover:bg-lime-600 text-black">
          {loading ? "注册中..." : "注册"}
        </Button>
      </form>
    </div>
  )
}
