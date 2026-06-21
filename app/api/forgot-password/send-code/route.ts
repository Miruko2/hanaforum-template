import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"
import { sendResetOtpEmail, hasAnyEmailProvider } from "@/lib/mailer"

// 忘记密码 · 第一步：按邮箱发送 6 位重置验证码。公开端点（无需登录）。
// 多通道发信（Resend → Brevo 兜底，见 lib/mailer.ts）。防刷：蜜罐 + 按 IP 限频 + 同用户 60 秒冷却。
// 反枚举：无论邮箱是否注册，成功路径一律返回同一句通用提示（不泄露账号是否存在）。
export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const CODE_TTL_MS = 10 * 60 * 1000 // 验证码 10 分钟有效
const RESEND_COOLDOWN_MS = 60 * 1000 // 同一用户 60 秒重发冷却
const HOURLY_IP_LIMIT = 5 // 同一 IP 每小时最多发 5 次重置码

// 统一的「成功」响应：注册与否都返回它，避免邮箱枚举。
const GENERIC_OK = {
  status: "sent",
  message: "若该邮箱已注册，验证码已发送，请查收（含垃圾箱）",
}

function sixDigitCode(): string {
  return String(crypto.randomInt(100000, 1000000)) // 100000–999999
}
function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex")
}
function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for") || ""
  const first = xff.split(",")[0].trim()
  return first || req.headers.get("x-real-ip") || "unknown"
}
function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    // 蜜罐：真实用户看不到 website 字段；机器人填了 → 静默「假成功」丢弃。
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return NextResponse.json(GENERIC_OK)
    }

    const email = String(body.email ?? "").trim().toLowerCase()
    if (!email || email.length > 200 || !isEmail(email)) {
      return NextResponse.json({ error: "请输入有效的邮箱地址" }, { status: 400 })
    }

    const ip = clientIp(req)

    // 按 IP 限频：查该 IP 近一小时发了多少次（查询出错则放行，别误伤真人）。
    if (ip !== "unknown") {
      try {
        const since1h = new Date(Date.now() - 3600_000).toISOString()
        const { count } = await supabaseAdmin
          .from("password_reset_codes")
          .select("user_id", { count: "exact", head: true })
          .eq("request_ip", ip)
          .gte("last_sent_at", since1h)
        if ((count ?? 0) >= HOURLY_IP_LIMIT) {
          return NextResponse.json({ error: "操作太频繁了，请稍后再试" }, { status: 429 })
        }
      } catch (e) {
        console.warn("[forgot-password/send-code] IP 限频检查失败，放行:", e)
      }
    }

    // 反查用户。查不到 → 仍返回通用成功（不泄露邮箱是否注册），但不发信。
    let userId: string | null = null
    try {
      const { data, error } = await supabaseAdmin.rpc("find_user_id_by_email", { p_email: email })
      if (!error && data) userId = data as string
    } catch (e) {
      console.error("[forgot-password/send-code] 反查用户失败:", e)
    }
    if (!userId) {
      return NextResponse.json(GENERIC_OK)
    }

    // 没有任何发送通道（误配）→ 如实报错（这是改密码，绝不假装已发）。
    if (!hasAnyEmailProvider()) {
      console.warn("[forgot-password/send-code] 未配置任何发送通道")
      return NextResponse.json({ error: "邮件服务暂时不可用，请稍后再试" }, { status: 503 })
    }

    // 同一用户 60 秒重发冷却。
    const { data: existing } = await supabaseAdmin
      .from("password_reset_codes")
      .select("last_sent_at")
      .eq("user_id", userId)
      .maybeSingle()
    if (
      existing?.last_sent_at &&
      Date.now() - new Date(existing.last_sent_at).getTime() < RESEND_COOLDOWN_MS
    ) {
      return NextResponse.json(
        { status: "cooldown", error: "验证码刚发过，请 1 分钟后再试" },
        { status: 429 },
      )
    }

    // 生成并存储验证码（哈希），重置尝试次数。
    const code = sixDigitCode()
    await supabaseAdmin.from("password_reset_codes").upsert(
      {
        user_id: userId,
        code_hash: sha256(code),
        code_expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
        attempts: 0,
        last_sent_at: new Date().toISOString(),
        request_ip: ip === "unknown" ? null : ip,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )

    const result = await sendResetOtpEmail(email, code)
    if (result.ok) {
      return NextResponse.json(GENERIC_OK)
    }

    // 没发出去：撤销 last_sent_at + code_hash，避免冷却误判「刚发过」、且不留死码。
    await supabaseAdmin
      .from("password_reset_codes")
      .update({ last_sent_at: null, code_hash: null })
      .eq("user_id", userId)

    if (result.reason === "quota") {
      return NextResponse.json(
        { error: "今日验证码发送已达上限，请明天再试" },
        { status: 429 },
      )
    }
    return NextResponse.json({ error: "验证码发送失败，请稍后重试" }, { status: 502 })
  } catch (e: any) {
    console.error("[forgot-password/send-code] 未知错误:", e)
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
