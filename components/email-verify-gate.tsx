"use client"

import { useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { useToast } from "@/hooks/use-toast"
import { MailCheck, X } from "lucide-react"

// 卡内斜向交错文字流：每行=一段重复短语，渲染两份 → translateX -50% 无缝循环。
// 倾斜「╲」与移动轴一致：上段沿 ╲ 向左上流，下段向右下流，自然不违和。
const TICK_A = "認証 · VERIFY · ACCESS · 萤火虫之国 · OTP · SECURE · "
const TICK_B = "SECURITY · 認証 · HANAKO · VERIFY · CODE · ACCESS · "
const TICK_C = "ACCESS · OTP · 萤火虫之国 · 認証 · VERIFY · SECURE · "
const TICK_D = "VERIFY · CODE · 認証 · SECURITY · HANAKO · ACCESS · "

// 5×7 点阵数字字模（'1'=亮珠 '0'=灭珠），用于验证码点阵显示
const GLYPHS: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
}

// 一个验证码位：有数字则点亮对应 5×7 点阵，否则全灭（淡珠占位）；active=当前待输入位
function DotDigit({ char, active }: { char?: string; active?: boolean }) {
  const rows = char && GLYPHS[char] ? GLYPHS[char] : null
  return (
    <div className={`evg-cell${active ? " is-active" : ""}`}>
      {Array.from({ length: 35 }).map((_, k) => {
        const on = rows ? rows[Math.floor(k / 5)][k % 5] === "1" : false
        return <span key={k} className={on ? "on" : undefined} />
      })}
    </div>
  )
}

/**
 * 邮箱验证门禁（懒触发 OTP）—— 绝区零风格弹窗。
 * 深色切角面板 + 霓虹描边 + 型号头部条 + 卡内斜向水印文字 + 网点扫描线 + 角标/十字标 + 酸性切角按钮。
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
  const [errMsg, setErrMsg] = useState("") // 验证码错误提示条文案（空=不显示）
  const [errKey, setErrKey] = useState(0)  // 每次报错 +1，强制重挂载重放入场动画

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
        // 验证码错误/过期 → 弹绝区零红色提示条（替代普通 toast）
        setErrMsg(data.error || "验证码错误")
        setErrKey((k) => k + 1)
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
  // 型号风序列号（取 user.id 前 4 位，稳定不抖动；纯装饰）
  const serial = (user?.id || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "FFK0"

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

          {/* 外层=霓虹切角边框，内层=深色主体（卡片所有内容都在内层、被裁切） */}
          <div key={`panel-${openCount}`} className="evg-panel" onClick={(e) => e.stopPropagation()}>
            <div className="evg-inner">
              {/* 卡内斜向交错文字流（被卡片裁切，仅卡内可见） */}
              <div className="evg-tick evg-tick-1" aria-hidden><span className="evg-tick-row">{TICK_A + TICK_A}</span></div>
              <div className="evg-tick evg-tick-2" aria-hidden><span className="evg-tick-row">{TICK_B + TICK_B}</span></div>
              <div className="evg-tick evg-tick-3" aria-hidden><span className="evg-tick-row">{TICK_C + TICK_C}</span></div>
              <div className="evg-tick evg-tick-4" aria-hidden><span className="evg-tick-row">{TICK_D + TICK_D}</span></div>

              <span className="evg-tex" aria-hidden />
              <span className="evg-glow" aria-hidden />
              <span className="evg-corner evg-corner-tl" aria-hidden />
              <span className="evg-corner evg-corner-br" aria-hidden />
              <span className="evg-reg" aria-hidden />

              {/* 型号风头部条：危险条 + 单色等宽标签 + 闪烁状态点 + 收起 */}
              <div className="evg-head">
                <span className="evg-head-haz" aria-hidden />
                <span className="evg-head-label">// 認証 · SECURITY</span>
                <span className="evg-head-stat"><i className="evg-dot" aria-hidden />REQ-OTP</span>
                <button type="button" className="evg-close" aria-label="收起" onClick={minimize}>
                  <X style={{ width: 15, height: 15 }} />
                </button>
              </div>

              <div className="evg-body">
                <MailCheck className="evg-icon" />
                <span className="evg-chip">認証 · VERIFY</span>
                <h3 className="evg-title" data-text="验证邮箱">验证邮箱</h3>

                {step === "send" ? (
                  <>
                    <p className="evg-sub">
                      向 <b>{user?.email}</b> 发送 6 位验证码
                    </p>
                    <button type="button" className="evg-btn" onClick={handleSend} disabled={busy} data-loading={busy || undefined} aria-busy={busy || undefined}>
                      {busy ? null : <><span className="evg-btn-cv" aria-hidden>»</span>发送验证码</>}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="evg-sub">
                      验证码已发到 <b>{user?.email}</b>
                    </p>
                    {errMsg && (
                      <div key={errKey} className="evg-err" role="alert">
                        <span className="evg-err-haz" aria-hidden />
                        <span className="evg-err-text">{errMsg}</span>
                      </div>
                    )}
                    <div className="evg-code">
                      <input
                        className="evg-code-input"
                        value={code}
                        onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setErrMsg("") }}
                        inputMode="numeric"
                        maxLength={6}
                        autoFocus
                        aria-label="6 位验证码"
                      />
                      <div className="evg-code-cells" aria-hidden>
                        {Array.from({ length: 6 }).map((_, i) => (
                          <DotDigit key={i} char={code[i]} active={i === code.length} />
                        ))}
                      </div>
                    </div>
                    <button type="button" className="evg-btn" onClick={handleVerify} disabled={busy} data-loading={busy || undefined} aria-busy={busy || undefined}>
                      {busy ? null : <><span className="evg-btn-cv" aria-hidden>»</span>验证</>}
                    </button>
                    <button type="button" className="evg-btn-ghost" onClick={handleSend} disabled={busy}>
                      重新发送
                    </button>
                  </>
                )}
              </div>

              <span className="evg-serial" aria-hidden>REQ://OTP-6 · NODE-{serial}</span>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" className="evg-ball" aria-label="验证邮箱" onClick={expand}>
          <span className="evg-ball-ring" aria-hidden />
          <span className="evg-ball-core" aria-hidden />
          <MailCheck className="evg-ball-icon" style={{ width: 9, height: 9 }} />
        </button>
      )}
    </>,
    document.body,
  )
}

// ── 样式（绝区零 / 酸性图形：深色切角面板 + 霓虹描边 + 型号头部 + 斜向文字 + 网点扫描线 + 角标/十字 + 切角按钮）──
const EVG_CSS = `
.evg-root{
  position:fixed; inset:0; z-index:99990;
  --acc:#2ee36b; --acc-rgb:46,227,107; --soft-rgb:122,240,166; --flash:#dcffe8; --ink:#06140c;
  --notch:15px;
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
  transform:rotate(-12deg); pointer-events:none;
  background:repeating-linear-gradient(-55deg,
    rgba(var(--acc-rgb),0.9) 0, rgba(var(--acc-rgb),0.9) 12px,
    transparent 12px, transparent 28px);
}
.evg-bg-band-1{ top:24%; animation:evg-flow 2.4s linear infinite; }
.evg-bg-band-2{ bottom:22%; animation:evg-flow-rev 3s linear infinite; }
.evg-flash{ position:absolute; inset:0; background:var(--flash); opacity:0; pointer-events:none; animation:evg-flash .5s ease-out .04s both; }

/* 入场圆球：真·圆形，坠落→落定→炸开淡出 */
.evg-orb{
  position:absolute; left:50%; top:50%; width:34px; height:34px; border-radius:50%;
  /* 纯实心绿球（坠落 → 炸开成弹窗）。orb 本就带 transform 动画(坠落+scale)走合成层、
     圆边 GPU 抗锯齿，不需要 radial 羽化——羽化=实心+透明边+外发光叠成「甜甜圈」，正是之前看着丑的根因 */
  background:var(--acc);
  box-shadow:0 0 18px rgba(var(--acc-rgb),0.6);
  transform:translate(-50%,-50%); pointer-events:none;
  animation:evg-orb .82s cubic-bezier(0.2,0.9,0.3,1) both;
}

/* ── 面板：外层=霓虹切角边框，内层=深色主体（切角一致，露出 ~1.6px 当霓虹边） ── */
.evg-panel{
  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  width:clamp(316px,90vw,398px); padding:1.6px; box-sizing:border-box;
  background:linear-gradient(150deg, rgba(var(--acc-rgb),0.95), rgba(var(--acc-rgb),0.28) 58%, rgba(var(--acc-rgb),0.7));
  clip-path:polygon(0 0, calc(100% - var(--notch)) 0, 100% var(--notch), 100% 100%, var(--notch) 100%, 0 calc(100% - var(--notch)));
  filter:drop-shadow(0 22px 50px rgba(0,0,0,0.6)) drop-shadow(0 0 26px rgba(var(--acc-rgb),0.22));
  transform-origin:center;
  animation:evg-panel-in .4s cubic-bezier(0.16,1,0.3,1) .5s both;
}
.evg-inner{
  position:relative; overflow:hidden; box-sizing:border-box;
  padding:42px 28px 32px;
  background:linear-gradient(165deg, rgba(24,26,30,0.985), rgba(12,13,16,0.99));
  clip-path:polygon(0 0, calc(100% - var(--notch)) 0, 100% var(--notch), 100% 100%, var(--notch) 100%, 0 calc(100% - var(--notch)));
  color:#e6e8eb; text-align:center;
}

/* 卡内斜向文字流：沿 ╲ 轴流动；上段→左上，下段→右下；2 份内容 translateX -50% 无缝 */
.evg-tick{ position:absolute; left:-50%; right:-50%; pointer-events:none; z-index:0; }
.evg-tick-row{
  display:inline-block; white-space:nowrap;
  font-size:clamp(22px,5.4vw,38px); font-weight:900; font-style:italic; letter-spacing:.05em;
  color:rgba(208,214,220,0.05);
  -webkit-text-stroke:1px rgba(208,214,220,0.075);
  will-change:transform;
}
.evg-tick-1{ top:11%; transform:rotate(15deg); }
.evg-tick-2{ top:25%; transform:rotate(15deg); }
.evg-tick-3{ bottom:25%; transform:rotate(15deg); }
.evg-tick-4{ bottom:10%; transform:rotate(15deg); }
.evg-tick-1 .evg-tick-row{ animation:evg-tickL 13s linear infinite; }
.evg-tick-2 .evg-tick-row{ animation:evg-tickL 17s linear infinite; }
.evg-tick-3 .evg-tick-row{ animation:evg-tickR 15s linear infinite; }
.evg-tick-4 .evg-tick-row{ animation:evg-tickR 19s linear infinite; }

.evg-tex{
  position:absolute; inset:0; pointer-events:none; opacity:.5; z-index:1;
  background-image:
    radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1.2px),
    repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 5px);
  background-size:14px 14px, auto;
}
.evg-glow{
  position:absolute; inset:0; pointer-events:none; z-index:1;
  background:radial-gradient(120% 62% at 50% 0%, rgba(var(--acc-rgb),0.12), transparent 62%);
  opacity:.7; animation:evg-flicker 3.4s ease-in-out 1.2s infinite;
}
.evg-corner{ position:absolute; width:14px; height:14px; border:2px solid var(--acc); opacity:.7; pointer-events:none; z-index:3; }
.evg-corner-tl{ top:9px; left:9px; border-right:none; border-bottom:none; }
.evg-corner-br{ bottom:9px; right:9px; border-left:none; border-top:none; }
.evg-reg{
  position:absolute; top:46px; right:15px; width:11px; height:11px; opacity:.5; pointer-events:none; z-index:3;
  background:
    linear-gradient(var(--acc),var(--acc)) center/100% 1.5px no-repeat,
    linear-gradient(var(--acc),var(--acc)) center/1.5px 100% no-repeat;
}

/* 型号风头部条 */
.evg-head{
  position:absolute; top:0; left:0; right:0; height:27px; z-index:4;
  display:flex; align-items:center; gap:8px; padding-right:9px;
  background:rgba(0,0,0,0.34); border-bottom:1px solid rgba(var(--acc-rgb),0.4);
}
.evg-head-haz{
  width:44px; align-self:stretch;
  background:repeating-linear-gradient(-55deg, var(--acc) 0, var(--acc) 7px, rgba(var(--acc-rgb),0.12) 7px, rgba(var(--acc-rgb),0.12) 14px);
}
.evg-head-label{ font-family:ui-monospace,Menlo,Consolas,monospace; font-size:10px; font-weight:700; letter-spacing:.12em; color:#9fe0b6; white-space:nowrap; }
.evg-head-stat{ margin-left:auto; display:inline-flex; align-items:center; gap:5px; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:9.5px; font-weight:700; letter-spacing:.1em; color:#c2f3d3; }
.evg-dot{ width:6px; height:6px; border-radius:50%; background:var(--acc); box-shadow:0 0 7px rgba(var(--acc-rgb),0.9); animation:evg-blink 1.6s steps(1,end) infinite; }
.evg-close{ background:none; border:none; color:#aeb4bb; cursor:pointer; line-height:0; opacity:.8; padding:0; }
.evg-close:hover{ opacity:1; }

.evg-body{ position:relative; z-index:3; animation:evg-content-in .34s ease-out .72s both; }
.evg-icon{ width:30px; height:30px; color:var(--acc); display:block; margin:2px auto 8px; filter:drop-shadow(0 0 7px rgba(var(--acc-rgb),0.6)); }
.evg-chip{ display:inline-flex; align-items:center; padding:3px 11px; border-radius:3px; background:var(--acc); color:var(--ink); font-size:10.5px; font-weight:800; font-style:italic; letter-spacing:.22em; text-transform:uppercase; }
.evg-title{ position:relative; font-size:20px; font-weight:800; font-style:italic; letter-spacing:.03em; color:#eef1f4; margin:11px 0 6px; }
.evg-title::after{ content:attr(data-text); position:absolute; left:50%; top:0; transform:translate(-50%,0) translate(2px,1.5px); color:rgba(var(--acc-rgb),0.4); z-index:-1; pointer-events:none; }
.evg-sub{ font-size:13px; color:#a6aeb6; margin:0; line-height:1.6; }
.evg-sub b{ color:#e8edf1; font-weight:700; }
/* 验证码点阵输入：透明 input 覆盖捕获键盘，下层 6 个 5×7 绿点阵格显示数字 */
.evg-code{
  position:relative; margin-top:16px; min-height:56px; cursor:text;
  border:1px solid rgba(var(--acc-rgb),0.4); background:rgba(4,10,7,0.65);
  clip-path:polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
  display:flex; align-items:center; justify-content:center;
  transition:border-color .15s, box-shadow .15s;
}
.evg-code:focus-within{ border-color:var(--acc); box-shadow:0 0 0 3px rgba(var(--acc-rgb),0.2); }
.evg-code-input{
  position:absolute; inset:0; width:100%; height:100%; margin:0; padding:0;
  border:none; background:none; outline:none; color:transparent; caret-color:transparent;
  font-size:16px; cursor:text;
}
.evg-code-cells{ display:flex; gap:12px; pointer-events:none; }
.evg-cell{ display:grid; grid-template-columns:repeat(5,4px); grid-template-rows:repeat(7,4px); gap:1.6px; }
.evg-cell span{ width:4px; height:4px; border-radius:50%; background:rgba(var(--acc-rgb),0.09); }
.evg-cell span.on{ background:var(--acc); box-shadow:0 0 3px rgba(var(--acc-rgb),0.85); }
.evg-cell.is-active span{ background:rgba(var(--acc-rgb),0.18); animation:evg-cell-blink 1s steps(1,end) infinite; }
.evg-cell.is-active span.on{ background:var(--acc); }

/* 验证码错误提示条：圆球出现→闪动→变白→变红→伸长成暗红长椭圆（hazard 斜纹 + 白字） */
.evg-err{
  position:relative; overflow:hidden; box-sizing:border-box;
  width:100%; height:38px; margin:14px auto 0;
  display:flex; align-items:center; justify-content:center;
  border-radius:999px; background:#561414;
  border:1px solid rgba(255,90,90,0.5); box-shadow:0 0 16px rgba(220,40,40,0.4);
  animation:evg-err-pop .9s cubic-bezier(0.5,0,0.2,1) both;
}
.evg-err-haz{
  position:absolute; inset:0; border-radius:999px; pointer-events:none;
  background:repeating-linear-gradient(-45deg, rgba(0,0,0,0.3) 0, rgba(0,0,0,0.3) 9px, transparent 9px, transparent 20px);
  opacity:0; animation:evg-err-fade .3s ease-out .66s both;
}
.evg-err-text{
  position:relative; z-index:1; color:#fff; font-size:13.5px; font-weight:800; letter-spacing:.08em;
  white-space:nowrap; text-shadow:0 1px 3px rgba(0,0,0,0.55);
  opacity:0; animation:evg-err-fade .3s ease-out .7s both;
}
.evg-btn{
  position:relative; overflow:hidden; width:100%; margin-top:16px; padding:12px 18px; box-sizing:border-box; border:none;
  display:flex; align-items:center; justify-content:center; min-height:46px;
  background:var(--acc); color:var(--ink); font-size:15px; font-weight:800; letter-spacing:.04em; cursor:pointer;
  clip-path:polygon(0 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%);
  box-shadow:0 6px 18px rgba(var(--acc-rgb),0.28); transition:filter .15s, transform .1s;
}
.evg-btn::after{ content:""; position:absolute; top:0; bottom:0; left:-40%; width:28%; background:linear-gradient(100deg, transparent, rgba(255,255,255,0.55), transparent); transform:skewX(-18deg); animation:evg-sheen 3.4s ease-in-out infinite; }
.evg-btn-cv{ font-weight:900; margin-right:7px; }
.evg-btn:hover:not(:disabled){ filter:brightness(1.08); }
.evg-btn:active:not(:disabled){ transform:translateY(1px); }
.evg-btn:disabled{ opacity:.5; cursor:default; box-shadow:none; }
.evg-btn:disabled::after{ display:none; }
/* 加载态：整条彩带由密集绿色灯珠点阵构成——灰黑底铺满绿点阵(radial 平铺)，
   一条斜向亮带(上层遮罩留出的透明窗)在点阵上流动；无文字 */
.evg-btn[data-loading="true"]{
  opacity:1; box-shadow:0 6px 18px rgba(0,0,0,0.35);
  background:
    repeating-linear-gradient(-55deg, rgba(21,23,26,0) 0, rgba(21,23,26,0) 7px, rgba(21,23,26,0.8) 13px, rgba(21,23,26,0.8) 28px),
    radial-gradient(circle, var(--acc) 1.5px, transparent 2.4px),
    #15171a;
  background-size: auto, 9px 9px, auto;
  animation:evg-led-flow 1.05s linear infinite;
}
.evg-btn-ghost{ margin-top:12px; background:none; border:none; color:var(--acc); font-size:13px; cursor:pointer; }
.evg-btn-ghost:disabled{ opacity:.5; cursor:default; }
.evg-serial{ position:absolute; left:0; right:0; bottom:9px; z-index:3; text-align:center; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:9px; letter-spacing:.14em; color:rgba(var(--soft-rgb),0.34); pointer-events:none; }

/* 小球：缩小的实心翠绿球 + 外圈半透明「呼吸灯」光球（来回胀缩）。 */
.evg-ball{
  position:fixed; left:18px; bottom:96px; z-index:9998; width:42px; height:42px;
  border:none; background:none; padding:0; cursor:pointer;
  /* 小球 portal 到 body、在 .evg-root 外，拿不到 root 变量 → 必须自带 */
  --acc:#2ee36b; --acc-rgb:46,227,107; --ink:#06140c;
  color:var(--ink);
  display:flex; align-items:center; justify-content:center;
}
/* 呼吸灯：半透明光球，中心浓→边缘透（无硬边无暗环），scale+opacity 来回呼吸收缩 */
.evg-ball-ring{
  position:absolute; left:50%; top:50%; width:42px; height:42px; border-radius:50%;
  transform:translate(-50%,-50%); pointer-events:none;
  background:radial-gradient(circle, rgba(var(--acc-rgb),0.5) 0%, rgba(var(--acc-rgb),0.16) 46%, transparent 72%);
  animation:evg-ball-breathe 2.6s ease-in-out infinite;
}
/* 中心实心小球（缩小） */
.evg-ball-core{
  position:absolute; left:50%; top:50%; width:18px; height:18px; border-radius:50%;
  transform:translate(-50%,-50%); pointer-events:none;
  background:var(--acc); box-shadow:0 0 7px rgba(var(--acc-rgb),0.5);
}
.evg-ball-icon{ position:relative; z-index:2; }

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
@keyframes evg-flicker{ 0%,100%{opacity:.55} 45%{opacity:.85} 72%{opacity:.62} }
/* 警告带：带子本身固定不动，只让内部斜条纹沿法向「流动」——滚动 background-position 正好
   1 个周期(28px) → 首尾图案重合、无缝。22.9/16.1 = 28 × (-55° 渐变方向单位向量)。
   band-1 朝左上、band-2 朝右下，两条互相斜向错动（而非整条带子上下平移）。 */
@keyframes evg-flow{ from{background-position:0 0} to{background-position:-22.9px -16.1px} }
@keyframes evg-flow-rev{ from{background-position:0 0} to{background-position:22.9px 16.1px} }
/* 斜向文字：沿自身基线方向流；-50% = 平移 1 份内容 → 无缝；tickL 向左上、tickR 向右下 */
@keyframes evg-tickL{ from{transform:translateX(0)} to{transform:translateX(-50%)} }
@keyframes evg-tickR{ from{transform:translateX(-50%)} to{transform:translateX(0)} }
@keyframes evg-sheen{ 0%{left:-40%} 58%{left:128%} 100%{left:128%} }
/* 加载点阵彩带：上层斜向遮罩流动 1 周期(28/sin55≈34.2px) → 亮带斜扫过绿点阵屏；点阵/底固定 */
@keyframes evg-led-flow{ from{ background-position:0 0,0 0,0 0 } to{ background-position:34.2px 0,0 0,0 0 } }
@keyframes evg-blink{ 0%,60%{opacity:1} 61%,100%{opacity:.18} }
@keyframes evg-cell-blink{ 0%,55%{opacity:1} 56%,100%{opacity:.4} }
/* 错误条入场：小白球→闪→变白→变红→横向伸长成暗红长椭圆（border-radius:999 始终胶囊端） */
@keyframes evg-err-pop{
  0%   { width:18px; height:18px; opacity:0; background:#ffffff; box-shadow:0 0 14px rgba(255,255,255,0.75); }
  5%   { opacity:1; }
  9%   { opacity:.4; }
  13%  { opacity:1; }
  17%  { opacity:.4; }
  22%  { opacity:1; background:#ffffff; }
  29%  { width:18px; height:18px; background:#ffffff; }
  37%  { width:22px; height:22px; background:#ff4d4d; box-shadow:0 0 18px rgba(255,70,70,0.7); }
  47%  { width:22px; height:22px; background:#8a1f1f; }
  100% { width:100%; height:38px; background:#561414; box-shadow:0 0 16px rgba(220,40,40,0.4); }
}
@keyframes evg-err-fade{ from{opacity:0} to{opacity:1} }
@keyframes evg-ball-breathe{ 0%,100%{ transform:translate(-50%,-50%) scale(0.66); opacity:.4 } 50%{ transform:translate(-50%,-50%) scale(1.3); opacity:.85 } }
@media (prefers-reduced-motion: reduce){
  .evg-orb{ display:none; }
  .evg-panel{ animation-duration:.01ms; animation-delay:0s; }
  .evg-bg-band,.evg-glow,.evg-ball-ring,.evg-flash,.evg-tick-row,.evg-dot,.evg-btn[data-loading="true"],.evg-cell.is-active span,.evg-err{ animation:none; }
  .evg-err-haz,.evg-err-text{ animation:none; opacity:1; }
  .evg-btn::after{ animation:none; display:none; }
}
`
