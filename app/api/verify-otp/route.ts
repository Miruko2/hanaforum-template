import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import crypto from "crypto"

// 校验邮箱验证码（OTP）。成功则写 verified_at，之后该用户即可正常发言。
export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MAX_ATTEMPTS = 5

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex")
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

    const body = (await req.json().catch(() => ({}))) as { code?: string }
    const code = String(body.code || "").trim()
    if (!/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "请输入 6 位数字验证码" }, { status: 400 })
    }

    const { data: ev } = await supabaseAdmin
      .from("email_verifications")
      .select("code_hash, code_expires_at, attempts, verified_at")
      .eq("user_id", user.id)
      .maybeSingle()

    if (!ev) {
      return NextResponse.json({ error: "请先获取验证码" }, { status: 400 })
    }
    if (ev.verified_at) {
      return NextResponse.json({ status: "already_verified" })
    }
    if (!ev.code_hash || !ev.code_expires_at || new Date(ev.code_expires_at) < new Date()) {
      return NextResponse.json({ error: "验证码已过期，请重新获取" }, { status: 400 })
    }
    if ((ev.attempts ?? 0) >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { error: "尝试次数过多，请重新获取验证码" },
        { status: 429 },
      )
    }

    if (sha256(code) !== ev.code_hash) {
      await supabaseAdmin
        .from("email_verifications")
        .update({ attempts: (ev.attempts ?? 0) + 1 })
        .eq("user_id", user.id)
      return NextResponse.json({ error: "验证码错误" }, { status: 400 })
    }

    // 通过：标记已验证，清掉验证码
    await supabaseAdmin
      .from("email_verifications")
      .update({ verified_at: new Date().toISOString(), code_hash: null })
      .eq("user_id", user.id)

    return NextResponse.json({ status: "verified" })
  } catch (e: any) {
    console.error("[verify-otp] 未知错误:", e)
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}
