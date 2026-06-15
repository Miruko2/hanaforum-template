"use client"

import { useCallback, useEffect, useState, type CSSProperties } from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { useToast } from "@/hooks/use-toast"
import { MailCheck, X } from "lucide-react"

/**
 * 邮箱验证门禁（懒触发 OTP）。自包含：
 *  - 自行判断当前账号是否“需验证”（注册晚于 enforce_since、未验证、且未处于超额兜底窗口）；
 *  - 需验证则显示顶部提示条；点开后弹验证码框（发码 → 回填 → 校验）。
 * 真正的拦截在 DB 触发器；本组件是引导用户完成验证的 UX。
 * gate 默认关闭（enforce_since=NULL）时本组件恒不显示。
 */
export default function EmailVerifyGate() {
  const { user } = useSimpleAuth()
  const { toast } = useToast()

  const [needsVerify, setNeedsVerify] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<"send" | "code">("send")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)

  const check = useCallback(async () => {
    if (!user) {
      setNeedsVerify(false)
      return
    }
    try {
      const [{ data: st }, { data: ev }] = await Promise.all([
        supabase
          .from("verification_state")
          .select("enforce_since, disabled_until")
          .eq("id", 1)
          .maybeSingle(),
        supabase
          .from("email_verifications")
          .select("verified_at")
          .eq("user_id", user.id)
          .maybeSingle(),
      ])
      const enforceSince = st?.enforce_since ? new Date(st.enforce_since) : null
      const disabledUntil = st?.disabled_until ? new Date(st.disabled_until) : null
      const verified = !!ev?.verified_at
      const createdAt = user.created_at ? new Date(user.created_at) : null
      const now = new Date()
      const need =
        !!enforceSince &&
        !verified &&
        !(disabledUntil && disabledUntil > now) &&
        !!createdAt &&
        createdAt > enforceSince
      setNeedsVerify(need)
    } catch {
      // 查询失败不打扰用户（DB 触发器仍是兜底）
      setNeedsVerify(false)
    }
  }, [user])

  useEffect(() => {
    check()
  }, [check])

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || ""
  }, [])

  const handleSend = async () => {
    if (busy) return
    setBusy(true)
    try {
      const token = await getToken()
      const res = await fetch(apiUrl("/api/send-otp"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.status === "sent") {
        setStep("code")
        toast({ title: "验证码已发送", description: "请查收邮箱（含垃圾箱）" })
      } else if (res.ok && (data.status === "skipped" || data.status === "already_verified")) {
        // 兜底放行 / 已验证 → 直接关闭
        toast({ title: "已通过验证", description: "现在可以正常发言了" })
        setOpen(false)
        await check()
      } else if (data.status === "cooldown") {
        // 冷却中：可能之前已发过，引导去输码
        setStep("code")
        toast({ title: "验证码已发送", description: data.error || "请查收邮箱后输入", variant: "destructive" })
      } else {
        toast({ title: "发送失败", description: data.error || "请稍后再试", variant: "destructive" })
      }
    } catch (e: any) {
      toast({ title: "发送失败", description: e?.message || "网络错误", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const handleVerify = async () => {
    if (busy) return
    if (!/^\d{6}$/.test(code)) {
      toast({ title: "请输入 6 位验证码", variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      const token = await getToken()
      const res = await fetch(apiUrl("/api/verify-otp"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && (data.status === "verified" || data.status === "already_verified")) {
        toast({ title: "验证成功", description: "现在可以正常发言了" })
        setOpen(false)
        setCode("")
        setStep("send")
        await check()
      } else {
        toast({ title: "验证失败", description: data.error || "请重试", variant: "destructive" })
      }
    } catch (e: any) {
      toast({ title: "验证失败", description: e?.message || "网络错误", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  if (!needsVerify) return null

  const overlay: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 99998,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    background: "rgba(5,5,7,0.7)",
  }
  const card: CSSProperties = {
    position: "relative",
    width: "100%",
    maxWidth: 380,
    borderRadius: 16,
    border: "1px solid rgba(163,230,53,0.25)",
    background: "linear-gradient(180deg, rgba(20,24,16,0.96), rgba(12,12,14,0.96))",
    padding: "28px 22px",
    fontFamily: "system-ui, sans-serif",
    color: "#e5e7eb",
    textAlign: "center",
  }
  const btn: CSSProperties = {
    marginTop: 16,
    width: "100%",
    padding: "11px 16px",
    borderRadius: 10,
    border: "none",
    background: "#65a30d",
    color: "#0a0a0a",
    fontSize: 15,
    fontWeight: 600,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.6 : 1,
  }

  return (
    <>
      {/* 顶部提示条 */}
      {!dismissed && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9998,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "8px 14px",
            background: "rgba(101,163,13,0.16)",
            borderBottom: "1px solid rgba(163,230,53,0.3)",
            backdropFilter: "blur(6px)",
            color: "#d9f99d",
            fontSize: 13,
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <span>发言前需先验证邮箱</span>
          <button
            type="button"
            onClick={() => {
              setOpen(true)
              setStep("send")
            }}
            style={{
              padding: "4px 12px",
              borderRadius: 999,
              border: "1px solid rgba(163,230,53,0.5)",
              background: "rgba(101,163,13,0.3)",
              color: "#ecfccb",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            立即验证
          </button>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setDismissed(true)}
            style={{ background: "none", border: "none", color: "#a3a3a3", cursor: "pointer", lineHeight: 0 }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
      )}

      {/* 验证码弹窗 */}
      {open && (
        <div style={overlay} onClick={() => !busy && setOpen(false)}>
          <div style={card} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="关闭"
              onClick={() => !busy && setOpen(false)}
              style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", color: "#9ca3af", cursor: "pointer", lineHeight: 0 }}
            >
              <X style={{ width: 18, height: 18 }} />
            </button>
            <MailCheck style={{ width: 36, height: 36, margin: "0 auto 12px", display: "block", color: "#a3e635" }} />
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#ecfccb", margin: "0 0 8px" }}>验证邮箱</h3>

            {step === "send" ? (
              <>
                <p style={{ fontSize: 14, color: "#cbd5e1", margin: 0 }}>
                  我们会向 <b style={{ color: "#fff" }}>{user?.email}</b> 发送一个 6 位验证码。
                </p>
                <button type="button" style={btn} onClick={handleSend} disabled={busy}>
                  {busy ? "发送中..." : "发送验证码"}
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 14, color: "#cbd5e1", margin: 0 }}>
                  验证码已发到 <b style={{ color: "#fff" }}>{user?.email}</b>，输入它：
                </p>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6 位验证码"
                  style={{
                    marginTop: 14,
                    width: "100%",
                    padding: "11px 14px",
                    borderRadius: 10,
                    border: "1px solid #3f3f46",
                    background: "#18181b",
                    color: "#fff",
                    fontSize: 20,
                    letterSpacing: 6,
                    textAlign: "center",
                    fontFamily: "monospace",
                  }}
                />
                <button type="button" style={btn} onClick={handleVerify} disabled={busy}>
                  {busy ? "验证中..." : "验证"}
                </button>
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={busy}
                  style={{ marginTop: 10, background: "none", border: "none", color: "#a3e635", fontSize: 13, cursor: busy ? "default" : "pointer" }}
                >
                  重新发送
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
