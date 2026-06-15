import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"

// 发送邮箱验证码（OTP）。懒触发：由前端在“需验证用户”要发言时调用。
// 关键兜底：Resend 发不出/超额/未配置 → 当日全局关闭验证 + 直接放行本用户，
//          绝不把用户卡死（与 SQL 侧 fail-open 一致）。
export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const RESEND_API_KEY = process.env.RESEND_API_KEY || ""
const RESEND_FROM = process.env.RESEND_FROM || ""
// 邮件正文内图片/链接需用绝对地址（邮件客户端无法解析相对路径）
const SITE_URL = "https://forum.hanakos.cc"

const CODE_TTL_MS = 10 * 60 * 1000 // 验证码 10 分钟有效
const RESEND_COOLDOWN_MS = 60 * 1000 // 重发冷却 60 秒

function sixDigitCode(): string {
  return String(crypto.randomInt(100000, 1000000)) // 100000–999999
}
function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex")
}
// 下一个 UTC+8 零点（“当日”按中国时区算）
function endOfDayShanghaiISO(): string {
  const TZ_MIN = 8 * 60
  const shifted = new Date(Date.now() + TZ_MIN * 60000)
  shifted.setUTCHours(24, 0, 0, 0) // 推到 UTC+8 钟面的下一个零点
  return new Date(shifted.getTime() - TZ_MIN * 60000).toISOString()
}

async function markVerified(userId: string) {
  await supabaseAdmin
    .from("email_verifications")
    .upsert(
      { user_id: userId, verified_at: new Date().toISOString(), code_hash: null },
      { onConflict: "user_id" },
    )
}
async function disableVerificationToday() {
  await supabaseAdmin
    .from("verification_state")
    .update({ disabled_until: endOfDayShanghaiISO(), updated_at: new Date().toISOString() })
    .eq("id", 1)
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : ""
    if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 })

    const { data: authData, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: "登录已过期" }, { status: 401 })
    }
    const user = authData.user
    const email = user.email
    if (!email) return NextResponse.json({ error: "账号没有绑定邮箱" }, { status: 400 })

    // 已验证：直接返回
    const { data: ev } = await supabaseAdmin
      .from("email_verifications")
      .select("verified_at, last_sent_at")
      .eq("user_id", user.id)
      .maybeSingle()
    if (ev?.verified_at) return NextResponse.json({ status: "already_verified" })

    // 全局已因超额关闭 → 直接放行（兜底）
    const { data: st } = await supabaseAdmin
      .from("verification_state")
      .select("disabled_until")
      .eq("id", 1)
      .maybeSingle()
    if (st?.disabled_until && new Date(st.disabled_until) > new Date()) {
      await markVerified(user.id)
      return NextResponse.json({ status: "skipped" })
    }

    // Resend 未配置（本地无 env / 部署遗漏）→ 仅放行当前用户，【不动全局开关】。
    // 关键：本地 dev 连的是同一个线上 Supabase，若在此 disableVerificationToday()
    // 会把线上验证全局关到当天 —— 故这里绝不碰 verification_state。
    if (!RESEND_API_KEY || !RESEND_FROM) {
      console.warn("[send-otp] RESEND_API_KEY / RESEND_FROM 未配置，仅放行当前用户")
      await markVerified(user.id)
      return NextResponse.json({ status: "skipped" })
    }

    // 重发冷却
    if (ev?.last_sent_at && Date.now() - new Date(ev.last_sent_at).getTime() < RESEND_COOLDOWN_MS) {
      return NextResponse.json(
        { status: "cooldown", error: "验证码刚发过，请稍后再试" },
        { status: 429 },
      )
    }

    // 生成并存储验证码（哈希）
    const code = sixDigitCode()
    await supabaseAdmin.from("email_verifications").upsert(
      {
        user_id: user.id,
        code_hash: sha256(code),
        code_expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        attempts: 0,
        last_sent_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )

    // 通过 Resend REST API 发信
    let status = 0 // 0 = 网络异常 / 未发出
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [email],
          subject: `【萤火虫之国】验证码 ${code}`,
          html: `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>萤火虫之国 · 验证码</title>
</head>
<body style="margin:0;padding:0;background:#0b0d10">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0b0d10">萤火虫之国邮箱验证码 ${code}，10 分钟内有效，请勿泄露。</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0d10;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:480px;background:#15171a;border:1px solid #242832;border-radius:16px;overflow:hidden">
  <tr><td style="height:6px;line-height:6px;font-size:0;background:#2ee36b;background-image:repeating-linear-gradient(135deg,#2ee36b 0,#2ee36b 11px,#0b0d10 11px,#0b0d10 22px)">&nbsp;</td></tr>
  <tr><td style="padding:24px 28px 8px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;padding-right:14px">
        <img src="${SITE_URL}/icons/icon-192.png" width="52" height="52" alt="萤火虫之国" style="display:block;width:52px;height:52px;border-radius:12px;border:1px solid #2a2f38">
      </td>
      <td style="vertical-align:middle">
        <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;color:#2ee36b;font-size:11px;letter-spacing:2px;line-height:1.4">&#9635; HANAKOS&nbsp;//&nbsp;PASSPORT</div>
        <div style="color:#eef1f4;font-size:20px;font-weight:700;line-height:1.4;margin-top:3px">萤火虫之国 · 邮箱验证</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:14px 28px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e1013;border:1px solid #2a2f38;border-radius:12px">
      <tr><td align="center" style="padding:22px 14px 24px">
        <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;color:#7af0a6;font-size:11px;letter-spacing:4px;margin-bottom:12px">VERIFY&nbsp;CODE&nbsp;/&nbsp;验证码</div>
        <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:12px;color:#2ee36b;text-shadow:0 0 14px rgba(46,227,107,0.45);padding-left:12px">${code}</div>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 28px 4px;color:#a6aeb6;font-size:13px;line-height:1.8">
    验证码 <span style="color:#2ee36b">10 分钟</span> 内有效，请勿向任何人泄露。<br>
    如果这不是你本人的操作，忽略此邮件即可，账号不受影响。
  </td></tr>
  <tr><td align="center" style="padding:14px 20px 6px;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;color:#2ee36b;font-size:13px;letter-spacing:2px;line-height:1.5">
    ·&nbsp; &#730; &nbsp;&#10022;&nbsp; · &nbsp;&#8902;&nbsp; &#10022; &nbsp;&#730;&nbsp; · &nbsp;&#10022;&nbsp; &#8902; &nbsp;·&nbsp; &#730; &nbsp;&#10022;
  </td></tr>
  <tr><td style="padding:14px 28px 24px;border-top:1px solid #232730">
    <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;color:#5b636d;font-size:11px;letter-spacing:1px;line-height:1.6">
      <span style="color:#2ee36b">forum.hanakos.cc</span> &nbsp;·&nbsp; 此邮件由系统自动发送，请勿回复
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`,
        }),
      })
      status = r.status
      if (!r.ok) {
        const t = await r.text().catch(() => "")
        console.error("[send-otp] Resend 发送失败:", r.status, t.slice(0, 300))
      }
    } catch (e) {
      console.error("[send-otp] Resend 请求异常:", e)
      status = 0
    }

    // 发送成功
    if (status >= 200 && status < 300) {
      return NextResponse.json({ status: "sent" })
    }

    // 仅「429 超额/限流」走当日兜底放行 —— 这才是“发不出邮件”的预期场景（用户的核心需求）。
    // 其它失败（无效邮箱 4xx / Resend 5xx / 网络）一律【如实报错、不放行】，
    // 避免「随便填个邮箱 → 发送失败 → 自动通过」绕过验证。
    if (status === 429) {
      await disableVerificationToday()
      await markVerified(user.id)
      return NextResponse.json({ status: "skipped" })
    }

    return NextResponse.json(
      {
        error:
          status === 0
            ? "网络异常，验证码发送失败，请稍后重试"
            : "验证码发送失败，请确认邮箱地址是否正确",
      },
      { status: 502 },
    )
  } catch (e: any) {
    console.error("[send-otp] 未知错误:", e)
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
