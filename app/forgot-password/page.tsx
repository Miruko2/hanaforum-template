"use client"

import type React from "react"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { DotMatrixInput } from "@/components/auth/dot-matrix-input"
import { LoadingAnimation } from "@/components/ui/loading-animation"
import { cn } from "@/lib/utils"

type Step = "email" | "reset"

// 百叶窗叠层（沿用占位页那套氛围）
const blindsOverlayStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  backgroundImage: `repeating-linear-gradient(0deg,rgba(0,0,0,0.15),rgba(0,0,0,0.15) 2px,rgba(0,0,0,0.03) 2px,rgba(0,0,0,0.03) 4px)`,
  pointerEvents: "none",
  zIndex: 0,
  backdropFilter: "blur(0.7px)",
}

export default function ForgotPasswordPage() {
  const router = useRouter()
  const { toast } = useToast()

  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [website, setWebsite] = useState("") // 蜜罐：真实用户看不到、不填
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [cooldown, setCooldown] = useState(0)

  // 重发倒计时
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setError("")
    if (!email.trim()) {
      setError("请输入邮箱")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/forgot-password/send-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), website }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setNotice(data.message || "若该邮箱已注册，验证码已发送，请查收（含垃圾箱）")
        setStep("reset")
        setCooldown(60)
        toast({ title: "验证码已发送", description: "请查收邮箱（含垃圾箱）" })
      } else {
        setError(data.error || "发送失败，请稍后重试")
        // 服务端冷却中：同步前端倒计时，避免反复点击
        if (res.status === 429 && data.status === "cooldown") setCooldown(60)
      }
    } catch {
      setError("网络错误，请稍后重试")
    } finally {
      setLoading(false)
    }
  }

  async function doReset(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (!/^\d{6}$/.test(code.trim())) {
      setError("请输入 6 位数字验证码")
      return
    }
    if (password.length < 6) {
      setError("密码至少 6 位")
      return
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/forgot-password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        toast({ title: "密码已重置", description: "请用新密码登录" })
        router.push("/login")
      } else {
        setError(data.error || "重置失败，请稍后重试")
      }
    } catch {
      setError("网络错误，请稍后重试")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative px-4">
      <div style={blindsOverlayStyle} />

      <div className="w-full max-w-md p-6 rounded-xl glass-card neon-border z-10 relative">
        <div className="space-y-2 text-center mb-6">
          <h1 className="text-3xl font-bold text-lime-400">重置密码</h1>
          <p className="text-gray-400 text-sm">
            {step === "email"
              ? "输入注册邮箱，我们会给你发送验证码"
              : "输入收到的验证码并设置新密码"}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-900/30 text-red-400 text-sm" role="alert">
            {error}
          </div>
        )}

        {step === "email" ? (
          <form onSubmit={sendCode} className="space-y-4">
            {/* 蜜罐：隐藏字段，真实用户不可见、不可聚焦；机器人填了即被后端丢弃 */}
            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
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
              autoFocus
            />
            <Button
              type="submit"
              disabled={loading}
              className={cn("w-full bg-lime-600 hover:bg-lime-700 text-white")}
            >
              {loading ? (
                <span className="flex items-center">
                  <LoadingAnimation size="sm" color="text-background" />
                  <span className="ml-2">发送中...</span>
                </span>
              ) : (
                "发送验证码"
              )}
            </Button>
          </form>
        ) : (
          <form onSubmit={doReset} className="space-y-4">
            {notice && (
              <p className="text-xs text-lime-300/90" role="status">
                ✓ {notice}
              </p>
            )}
            <DotMatrixInput
              label="验证码"
              value={code}
              onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
              type="text"
              placeholderWord="CODE"
              inputMode="numeric"
              autoComplete="one-time-code"
              showCaption
              autoFocus
            />
            <DotMatrixInput
              label="新密码"
              value={password}
              onChange={setPassword}
              type="password"
              placeholderWord="PASS"
              autoComplete="new-password"
            />
            <DotMatrixInput
              label="确认新密码"
              value={confirm}
              onChange={setConfirm}
              type="password"
              placeholderWord="AGAIN"
              autoComplete="new-password"
            />

            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => sendCode()}
                disabled={cooldown > 0 || loading}
                className="text-lime-400 hover:text-lime-300 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                {cooldown > 0 ? `重新发送 (${cooldown}s)` : "重新发送验证码"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("email")
                  setError("")
                  setNotice("")
                }}
                className="text-gray-400 hover:text-gray-300"
              >
                换个邮箱
              </button>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className={cn("w-full bg-lime-600 hover:bg-lime-700 text-white")}
            >
              {loading ? (
                <span className="flex items-center">
                  <LoadingAnimation size="sm" color="text-background" />
                  <span className="ml-2">重置中...</span>
                </span>
              ) : (
                "重置密码"
              )}
            </Button>
          </form>
        )}

        <div className="text-center text-sm mt-6">
          <Link href="/login" className="text-gray-400 hover:text-lime-300">
            ← 返回登录
          </Link>
        </div>
      </div>
    </div>
  )
}
