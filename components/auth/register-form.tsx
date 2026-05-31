// components/auth/register-form.tsx
"use client"

import type React from "react"

import { useState } from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Mail } from "lucide-react"

export function RegisterForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [username, setUsername] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  // 注册成功后切到"请查邮箱"视图，不跳路由（避免邮箱出现在 URL）
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)
  const { signUp } = useSimpleAuth()
  const router = useRouter()
  const { toast } = useToast()

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

      // 切到"请查邮箱"视图。不再跳 /login，因为用户没点验证链接前登录会失败，
      // 直接跳过去会让人误以为注册流程结束了。
      setSubmittedEmail(email)
    } catch (err: any) {
      console.error("注册错误:", err);
      setError(err.message || "注册失败")
    } finally {
      setLoading(false)
    }
  }

  // 注册成功后的"请查邮箱"视图
  if (submittedEmail) {
    return (
      <div className="w-full max-w-md mx-auto p-8 rounded-2xl
        bg-black/20 backdrop-blur-lg border border-white/10 shadow-2xl
        transition-all duration-300 text-white">
        <div className="flex flex-col items-center text-center space-y-5">
          <div className="w-16 h-16 rounded-full bg-lime-500/20 flex items-center justify-center">
            <Mail className="w-8 h-8 text-lime-400" />
          </div>
          <h2 className="text-2xl font-bold text-lime-400">请查收验证邮件</h2>
          <div className="space-y-2 text-sm text-white/80 leading-relaxed">
            <p>
              我们已向 <span className="text-lime-300 font-mono break-all">{submittedEmail}</span> 发送了一封验证邮件。
            </p>
            <p className="font-semibold text-white">
              请打开邮箱点击邮件里的链接，激活后才能登录。
            </p>
          </div>

          <div className="w-full p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-left text-xs text-amber-200/90 space-y-1.5">
            <p>📮 <span className="font-semibold">发件人</span>：萤火虫之国 &lt;noreply@mail.hanakos.cc&gt;</p>
            <p>🔍 <span className="font-semibold">没收到？</span>请检查<span className="text-amber-300 font-semibold">「垃圾邮件」</span>文件夹（QQ、163 邮箱常见）</p>
            <p>⏱️ <span className="font-semibold">延迟</span>：通常 5-30 秒，国内邮箱偶尔 1-5 分钟</p>
          </div>

          <div className="w-full flex flex-col gap-2 pt-2">
            <Button
              onClick={() => router.push("/login")}
              className="w-full bg-lime-500 hover:bg-lime-600 text-black"
            >
              已完成验证，去登录
            </Button>
            <Button
              onClick={() => {
                setSubmittedEmail(null)
                setEmail("")
                setPassword("")
                setUsername("")
              }}
              variant="ghost"
              className="w-full text-white/60 hover:text-white hover:bg-white/5"
            >
              换个邮箱重新注册
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md mx-auto p-8 rounded-2xl
      bg-black/20 backdrop-blur-lg border border-white/10 shadow-2xl
      transition-all duration-300">
      <h2 className="text-2xl font-bold text-center text-lime-400 mb-6">注册</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="p-3 rounded-md bg-red-900/30 text-red-400 text-sm">{error}</div>}

        <div className="space-y-2">
          <Label htmlFor="username">用户名</Label>
          <Input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="bg-black/30 border-gray-800 focus:border-lime-500/50 text-white"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">邮箱</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bg-black/30 border-gray-800 focus:border-lime-500/50 text-white"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">密码</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="bg-black/30 border-gray-800 focus:border-lime-500/50 text-white"
          />
        </div>

        <Button type="submit" disabled={loading} className="w-full bg-lime-500 hover:bg-lime-600 text-black">
          {loading ? "注册中..." : "注册"}
        </Button>
      </form>
    </div>
  )
}
