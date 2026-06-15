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
          html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#222;line-height:1.6">
  <p>你的验证码是：</p>
  <p style="font-size:30px;font-weight:700;letter-spacing:6px;color:#16a34a;margin:8px 0">${code}</p>
  <p style="color:#666">10 分钟内有效。如果不是你本人操作，忽略此邮件即可。</p>
</div>`,
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
