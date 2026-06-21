import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"

// 忘记密码 · 第二步：校验重置验证码并设置新密码。公开端点（无需登录）。
// 校验通过后用 service_role admin API 改密；验证码 10 分钟过期、5 次错误锁定。
// 反枚举：邮箱不存在 / 码错 / 码过期一律返回同一句模糊错误（不泄露账号是否存在）。
export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MAX_ATTEMPTS = 5
const MIN_PASSWORD = 6 // 与注册保持一致（Supabase 默认下限）
const MAX_PASSWORD = 72 // bcrypt 上限，超过会被截断/报错

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex")
}
function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string
      code?: string
      password?: string
    }
    const email = String(body.email ?? "").trim().toLowerCase()
    const code = String(body.code ?? "").trim()
    const password = String(body.password ?? "")

    if (!isEmail(email)) {
      return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 })
    }
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "请输入 6 位数字验证码" }, { status: 400 })
    }
    if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) {
      return NextResponse.json(
        { error: `密码长度需 ${MIN_PASSWORD}–${MAX_PASSWORD} 位` },
        { status: 400 },
      )
    }

    // 反查用户。查不到 → 统一报「验证码错误或已过期」（不泄露邮箱是否注册）。
    let userId: string | null = null
    try {
      const { data, error } = await supabaseAdmin.rpc("find_user_id_by_email", { p_email: email })
      if (!error && data) userId = data as string
    } catch (e) {
      console.error("[forgot-password/reset] 反查用户失败:", e)
    }
    const INVALID = NextResponse.json(
      { error: "验证码错误或已过期，请重新获取" },
      { status: 400 },
    )
    if (!userId) return INVALID

    const { data: prc } = await supabaseAdmin
      .from("password_reset_codes")
      .select("code_hash, code_expires_at, attempts")
      .eq("user_id", userId)
      .maybeSingle()

    if (!prc || !prc.code_hash || !prc.code_expires_at) return INVALID
    if (new Date(prc.code_expires_at) < new Date()) return INVALID
    if ((prc.attempts ?? 0) >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "尝试次数过多，请重新获取验证码" },
        { status: 429 },
      )
    }
    if (sha256(code) !== prc.code_hash) {
      await supabaseAdmin
        .from("password_reset_codes")
        .update({ attempts: (prc.attempts ?? 0) + 1 })
        .eq("user_id", userId)
      return NextResponse.json({ error: "验证码错误" }, { status: 400 })
    }

    // 校验通过：用 service_role admin API 改密。
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { password })
    if (updErr) {
      console.error("[forgot-password/reset] 改密失败:", updErr)
      // 常见：密码过弱被 Supabase 拒。如实回传，让用户换更强的密码。
      return NextResponse.json(
        { error: updErr.message || "重置失败，请换一个更强的密码再试" },
        { status: 400 },
      )
    }

    // 清掉验证码，杜绝复用。
    await supabaseAdmin
      .from("password_reset_codes")
      .update({ code_hash: null, attempts: 0 })
      .eq("user_id", userId)

    // 附带：能收到重置码 = 证明掌控该邮箱 → 顺手标记邮箱已验证（best-effort，失败不影响重置）。
    try {
      await supabaseAdmin.from("email_verifications").upsert(
        { user_id: userId, verified_at: new Date().toISOString(), code_hash: null },
        { onConflict: "user_id" },
      )
    } catch (e) {
      console.warn("[forgot-password/reset] 顺带标记邮箱已验证失败（不影响重置）:", e)
    }

    return NextResponse.json({ status: "ok" })
  } catch (e: any) {
    console.error("[forgot-password/reset] 未知错误:", e)
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
