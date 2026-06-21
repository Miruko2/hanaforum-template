import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"
import { sendOtpEmail, hasAnyEmailProvider } from "@/lib/mailer"

// 发送邮箱验证码（OTP）。懒触发：由前端在“需验证用户”要发言时调用。
// 多通道发信：Resend 满了自动切 SMTP 兜底（见 lib/mailer.ts）。
// 配额耗尽/发不出 → 【不放行】，返回 quota_exceeded 让前端提示用户明天再来（fail-closed）。
// 如需邮件全挂时临时全员放行，管理员手动设 verification_state.disabled_until（本路由仍读取）。
export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const CODE_TTL_MS = 10 * 60 * 1000 // 验证码 10 分钟有效
const RESEND_COOLDOWN_MS = 60 * 1000 // 重发冷却 60 秒

function sixDigitCode(): string {
  return String(crypto.randomInt(100000, 1000000)) // 100000–999999
}
function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex")
}
async function markVerified(userId: string) {
  await supabaseAdmin
    .from("email_verifications")
    .upsert(
      { user_id: userId, verified_at: new Date().toISOString(), code_hash: null },
      { onConflict: "user_id" },
    )
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

    // 一个发送通道都没配（本地无 env / 部署遗漏）→ 仅放行当前用户，【不动全局开关】。
    // 关键：本地 dev 连的是同一个线上 Supabase，若在此 disableVerificationToday()
    // 会把线上验证全局关到当天 —— 故这里绝不碰 verification_state。
    if (!hasAnyEmailProvider()) {
      console.warn("[send-otp] 未配置任何发送通道（Resend / SMTP），仅放行当前用户")
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

    // 多通道发送（一家满了自动切下一家）
    const result = await sendOtpEmail(email, code)

    if (result.ok) {
      return NextResponse.json({ status: "sent" })
    }

    // 未发出任何信：撤销冷却(last_sent_at)与验证码，避免用户重试时被误判“刚发过”。
    await supabaseAdmin
      .from("email_verifications")
      .update({ last_sent_at: null, code_hash: null })
      .eq("user_id", user.id)

    // 所有通道都超额/限流 → 【不放行】，拦住并提示明天再来（fail-closed，用户要求）。
    // 注：disabled_until 仍由本路由读取（兜底窗口），但不再自动设置；
    //     如需邮件全挂时临时全员放行，管理员手动 UPDATE verification_state.disabled_until 即可。
    if (result.reason === "quota") {
      return NextResponse.json(
        { status: "quota_exceeded", error: "今日验证码发送已达上限，请明天再来验证后发言" },
        { status: 429 },
      )
    }

    // 地址无效：如实报错、不放行（避免「随便填个邮箱→发送失败→自动通过」绕过验证）
    if (result.reason === "invalid") {
      return NextResponse.json(
        { error: "验证码发送失败，请确认邮箱地址是否正确" },
        { status: 502 },
      )
    }

    // 网络/服务端异常：如实报错、不放行（可重试）
    return NextResponse.json(
      { error: "验证码发送失败，请稍后重试" },
      { status: 502 },
    )
  } catch (e: any) {
    console.error("[send-otp] 未知错误:", e)
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
