"use client"

import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { useToast } from "@/hooks/use-toast"
import { MailCheck, X } from "lucide-react"

/**
 * 邮箱验证门禁（懒触发 OTP）—— 绝区零风格弹窗。
 * 视觉与页面转场（PageRibbonTransition / globals.css .ptr-*）同源，但走「深色高对比 +
 * 霓虹描边」而非绿色实心：深色磨砂面板 + 霓虹绿描边/警告条/角标 + 细网点扫描线。
 * 入场：一颗发光圆球从顶部坠落 → 炸开成深色面板（内容随后淡入）。
 * 关闭=缩成发光小球，点它再展开。真正拦截在 DB 触发器；gate 关闭时恒不显示。
 */
export default function EmailVerifyGate() {
  const { user } = useSimpleAuth()
  const { toast } = useToast()

  const [needsVerify, setNeedsVerify] = useState(false)
  const [open, setOpen] = useState(true)
  const [openCount, setOpenCount] = useState(0)
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
        toast({ title: "已通过验证", description: "现在可以正常发言了" })
        await check()
      } else if (data.status === "cooldown") {
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

  if (!needsVerify || typeof document === "undefined") return null

  const minimize = () => setOpen(false)
  const expand = () => {
    setStep("send")
    setOpen(true)
    setOpenCount((c) => c + 1)
  }

  return createPortal(
    <>
      <style>{EVG_CSS}</style>
      {open ? (
        <div className="evg-root" role="dialog" aria-modal="true" aria-label="验证邮箱">
          <div className="evg-backdrop" onClick={minimize}>
            <span className="evg-bg-band evg-bg-band-1" aria-hidden />
            <span className="evg-bg-band evg-bg-band-2" aria-hidden />
            <span className="evg-flash" aria-hidden />
          </div>

          {/* 入场圆球：坠落后炸开（独立元素，避免缩放把面板压成椭圆蛋） */}
          <span key={`orb-${openCount}`} className="evg-orb" aria-hidden />

          <div key={`panel-${openCount}`} className="evg-panel" onClick={(e) => e.stopPropagation()}>
            <span className="evg-tex" aria-hidden />
            <span className="evg-glow" aria-hidden />
            <span className="evg-haz" aria-hidden />
            <span className="evg-corner evg-corner-tl" aria-hidden />
            <span className="evg-corner evg-corner-br" aria-hidden />
            <button type="button" className="evg-close" aria-label="收起" onClick={minimize}>
              <X style={{ width: 16, height: 16 }} />
            </button>

            <div className="evg-body">
              <MailCheck className="evg-icon" />
              <span className="evg-chip">認証 · VERIFY</span>
              <h3 className="evg-title">验证邮箱</h3>

              {step === "send" ? (
                <>
                  <p className="evg-sub">
                    向 <b>{user?.email}</b> 发送 6 位验证码
                  </p>
                  <button type="button" className="evg-btn" onClick={handleSend} disabled={busy}>
                    {busy ? "发送中..." : "发送验证码"}
                  </button>
                </>
              ) : (
                <>
                  <p className="evg-sub">
                    验证码已发到 <b>{user?.email}</b>
                  </p>
                  <input
                    className="evg-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="······"
                    autoFocus
                  />
                  <button type="button" className="evg-btn" onClick={handleVerify} disabled={busy}>
                    {busy ? "验证中..." : "验证"}
                  </button>
                  <button type="button" className="evg-btn-ghost" onClick={handleSend} disabled={busy}>
                    重新发送
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <button type="button" className="evg-ball" aria-label="验证邮箱" onClick={expand}>
          <MailCheck style={{ width: 22, height: 22 }} />
        </button>
      )}
    </>,
    document.body,
  )
}

// ── 样式（绝区零同源：深色磨砂 + 霓虹描边 + 警告条 + 网点扫描线 + 角标）──
const EVG_CSS = `
.evg-root{
  position:fixed; inset:0; z-index:99990;
  --acc:#2ee36b; --acc-rgb:46,227,107; --soft-rgb:122,240,166; --flash:#dcffe8; --ink:#06140c;
  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
}
.evg-backdrop{
  position:absolute; inset:0; overflow:hidden;
  background:rgba(2,5,3,0.80);
  background-image:
    radial-gradient(circle, rgba(var(--soft-rgb),0.07) 1px, transparent 1.2px),
    repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 5px);
  background-size:22px 22px, auto;
  animation:evg-fade .26s ease-out both;
}
.evg-bg-band{
  position:absolute; left:-25%; right:-25%; height:40px; opacity:.09;
  transform:rotate(-12deg); will-change:transform; pointer-events:none;
  background:repeating-linear-gradient(-55deg,
    rgba(var(--acc-rgb),0.9) 0, rgba(var(--acc-rgb),0.9) 12px,
    transparent 12px, transparent 28px);
}
.evg-bg-band-1{ top:24%; animation:evg-drift 4.2s linear infinite; }
.evg-bg-band-2{ bottom:22%; animation:evg-drift-rev 5s linear infinite; }
.evg-flash{ position:absolute; inset:0; background:var(--flash); opacity:0; pointer-events:none; animation:evg-flash .5s ease-out .04s both; }

/* 入场圆球：真·圆形，坠落→落定→炸开淡出 */
.evg-orb{
  position:absolute; left:50%; top:50%; width:54px; height:54px; border-radius:50%;
  background:var(--acc);
  box-shadow:0 0 30px rgba(var(--acc-rgb),0.65);
  transform:translate(-50%,-50%); pointer-events:none;
  animation:evg-orb .82s cubic-bezier(0.2,0.9,0.3,1) both;
}

.evg-panel{
  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  width:clamp(312px,88vw,392px); padding:30px 32px 26px; box-sizing:border-box;
  background:linear-gradient(166deg, rgba(13,28,19,0.93), rgba(5,15,10,0.96));
  -webkit-backdrop-filter:blur(8px); backdrop-filter:blur(8px);
  border:1px solid rgba(var(--acc-rgb),0.45); border-radius:22px;
  box-shadow:0 24px 70px rgba(0,0,0,0.6), 0 0 46px rgba(var(--acc-rgb),0.16);
  color:#e7f6ec; text-align:center; overflow:hidden; transform-origin:center;
  animation:evg-panel-in .4s cubic-bezier(0.16,1,0.3,1) .5s both;
}
.evg-tex{
  position:absolute; inset:0; pointer-events:none; opacity:.5;
  background-image:
    radial-gradient(circle, rgba(var(--soft-rgb),0.10) 1px, transparent 1.2px),
    repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 5px);
  background-size:14px 14px, auto;
}
.evg-glow{
  position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(120% 62% at 50% 0%, rgba(var(--acc-rgb),0.20), transparent 62%);
  opacity:.7; animation:evg-flicker 3.4s ease-in-out 1.2s infinite;
}
.evg-haz{
  position:absolute; top:0; left:0; right:0; height:7px; transform-origin:left center;
  background:repeating-linear-gradient(-55deg,
    var(--acc) 0, var(--acc) 10px, rgba(var(--acc-rgb),0.15) 10px, rgba(var(--acc-rgb),0.15) 20px);
  animation:evg-haz-in .3s cubic-bezier(0.2,1,0.3,1) .9s both;
}
.evg-corner{ position:absolute; width:15px; height:15px; border:2px solid var(--acc); opacity:.65; pointer-events:none; }
.evg-corner-tl{ top:11px; left:11px; border-right:none; border-bottom:none; border-top-left-radius:5px; }
.evg-corner-br{ bottom:11px; right:11px; border-left:none; border-top:none; border-bottom-right-radius:5px; }
.evg-close{ position:absolute; top:11px; right:13px; z-index:3; background:none; border:none; color:#9fd9b4; cursor:pointer; line-height:0; opacity:.75; }
.evg-close:hover{ opacity:1; }

.evg-body{ position:relative; z-index:2; animation:evg-content-in .34s ease-out .72s both; }
.evg-icon{ width:32px; height:32px; color:var(--acc); display:block; margin:4px auto 8px; filter:drop-shadow(0 0 7px rgba(var(--acc-rgb),0.6)); }
.evg-chip{ display:inline-flex; align-items:center; padding:3px 11px; border-radius:4px; background:var(--acc); color:var(--ink); font-size:10.5px; font-weight:800; font-style:italic; letter-spacing:.22em; text-transform:uppercase; }
.evg-title{ font-size:19px; font-weight:800; font-style:italic; letter-spacing:.03em; color:#ecfccb; margin:11px 0 6px; }
.evg-sub{ font-size:13px; color:#9fc3ab; margin:0; line-height:1.6; }
.evg-sub b{ color:#d9f99d; font-weight:700; }
.evg-input{
  display:block; width:100%; margin-top:16px; padding:11px 14px; box-sizing:border-box;
  border:1px solid rgba(var(--acc-rgb),0.4); border-radius:10px; background:rgba(4,12,8,0.7); color:#fff;
  font-family:monospace; font-size:24px; letter-spacing:12px; text-align:center; outline:none;
  transition:border-color .15s, box-shadow .15s;
}
.evg-input::placeholder{ color:#3d5a48; letter-spacing:8px; }
.evg-input:focus{ border-color:var(--acc); box-shadow:0 0 0 3px rgba(var(--acc-rgb),0.2); }
.evg-btn{
  width:100%; margin-top:16px; padding:12px 18px; box-sizing:border-box; border:none; border-radius:10px;
  background:var(--acc); color:var(--ink); font-size:15px; font-weight:800; letter-spacing:.04em; cursor:pointer;
  box-shadow:0 6px 18px rgba(var(--acc-rgb),0.28); transition:filter .15s, transform .1s;
}
.evg-btn:hover:not(:disabled){ filter:brightness(1.08); }
.evg-btn:active:not(:disabled){ transform:translateY(1px); }
.evg-btn:disabled{ opacity:.5; cursor:default; box-shadow:none; }
.evg-btn-ghost{ margin-top:12px; background:none; border:none; color:var(--acc); font-size:13px; cursor:pointer; }
.evg-btn-ghost:disabled{ opacity:.5; cursor:default; }

.evg-ball{
  position:fixed; left:18px; bottom:96px; z-index:9998; width:50px; height:50px; border-radius:50%;
  border:none; color:var(--ink); cursor:pointer;
  background:var(--acc);
  display:flex; align-items:center; justify-content:center;
  box-shadow:0 8px 22px rgba(0,0,0,0.4), 0 0 20px rgba(var(--acc-rgb),0.5);
  animation:evg-ball-pulse 2.4s ease-in-out infinite;
}

@keyframes evg-fade{ from{opacity:0} to{opacity:1} }
@keyframes evg-flash{ 0%{opacity:0} 35%{opacity:.18} 100%{opacity:0} }
@keyframes evg-orb{
  0%   { opacity:0; transform:translate(-50%, calc(-50% - 300px)) scale(1); }
  16%  { opacity:1; }
  46%  { transform:translate(-50%, calc(-50% + 8px)) scale(1); }
  60%  { transform:translate(-50%, calc(-50% - 4px)) scale(1); }
  72%  { opacity:1; transform:translate(-50%,-50%) scale(1); }
  100% { opacity:0; transform:translate(-50%,-50%) scale(6); }
}
@keyframes evg-panel-in{ from{opacity:0; transform:translate(-50%,-50%) scale(0.36)} to{opacity:1; transform:translate(-50%,-50%) scale(1)} }
@keyframes evg-content-in{ from{opacity:0; transform:translateY(9px)} to{opacity:1; transform:none} }
@keyframes evg-haz-in{ from{opacity:0; transform:skewX(-12deg) scaleX(0)} to{opacity:1; transform:skewX(-12deg) scaleX(1)} }
@keyframes evg-flicker{ 0%,100%{opacity:.55} 45%{opacity:.85} 72%{opacity:.62} }
@keyframes evg-drift{ from{transform:translate3d(5%,0,0) rotate(-12deg)} to{transform:translate3d(-5%,0,0) rotate(-12deg)} }
@keyframes evg-drift-rev{ from{transform:translate3d(-5%,0,0) rotate(-12deg)} to{transform:translate3d(5%,0,0) rotate(-12deg)} }
@keyframes evg-ball-pulse{ 0%,100%{box-shadow:0 8px 22px rgba(0,0,0,0.4), 0 0 14px rgba(var(--acc-rgb),0.45)} 50%{box-shadow:0 8px 22px rgba(0,0,0,0.4), 0 0 28px rgba(var(--acc-rgb),0.78)} }
@media (prefers-reduced-motion: reduce){
  .evg-orb{ display:none; }
  .evg-panel{ animation-duration:.01ms; animation-delay:0s; }
  .evg-bg-band,.evg-glow,.evg-ball,.evg-flash{ animation:none; }
}
`
