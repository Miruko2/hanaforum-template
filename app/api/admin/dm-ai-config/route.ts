import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// 把 api_key 掩码：sk-1234567890abcdef → sk-****cdef
function maskApiKey(raw: string): string {
  if (!raw) return ""
  if (raw.length <= 8) return "****"
  return `${raw.slice(0, 3)}****${raw.slice(-4)}`
}

// 鉴权：必须是登录用户且在 admin_users 表里
async function requireAdmin(
  req: NextRequest,
): Promise<{ ok: true; userId: string } | { ok: false; res: NextResponse }> {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : ""
  if (!token) {
    return { ok: false, res: NextResponse.json({ error: "未登录" }, { status: 401 }) }
  }
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !authData?.user) {
    return { ok: false, res: NextResponse.json({ error: "认证失败或已过期" }, { status: 401 }) }
  }
  const { data: adminRow, error: adminErr } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle()
  if (adminErr) {
    console.error("[DM AI Config] 管理员查询错误:", adminErr)
    return { ok: false, res: NextResponse.json({ error: "服务器错误" }, { status: 500 }) }
  }
  if (!adminRow) {
    return { ok: false, res: NextResponse.json({ error: "无权限（非管理员）" }, { status: 403 }) }
  }
  return { ok: true, userId: authData.user.id }
}

const SELECT_COLS =
  "enabled, base_url, api_key, model, persona, proactive_enabled, cooldown_hours, max_unanswered, updated_at"

function shape(data: any) {
  return {
    enabled: !!data?.enabled,
    base_url: data?.base_url || "",
    api_key_masked: maskApiKey(data?.api_key || ""),
    api_key_set: !!data?.api_key,
    model: data?.model || "",
    persona: data?.persona || "",
    proactive_enabled: !!data?.proactive_enabled,
    cooldown_hours: typeof data?.cooldown_hours === "number" ? data.cooldown_hours : 24,
    max_unanswered: typeof data?.max_unanswered === "number" ? data.max_unanswered : 2,
    updated_at: data?.updated_at || null,
  }
}

// 未配置时的空壳（表/行还没建时让前端能显示"未配置"）
const EMPTY = {
  enabled: false,
  base_url: "",
  api_key_masked: "",
  api_key_set: false,
  model: "",
  persona: "",
  proactive_enabled: false,
  cooldown_hours: 24,
  max_unanswered: 2,
  updated_at: null,
}

// GET: 返回当前私信 AI 配置（api_key 掩码）
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res
  try {
    const { data, error } = await supabaseAdmin
      .from("dm_ai_config")
      .select(SELECT_COLS)
      .eq("id", 1)
      .maybeSingle()
    if (error) throw error
    return NextResponse.json(data ? shape(data) : EMPTY)
  } catch (error: any) {
    console.error("[DM AI Config] GET 错误:", error)
    return NextResponse.json({ error: error.message || "查询失败" }, { status: 500 })
  }
}

// PATCH: 更新私信 AI 配置。任意字段子集；api_key 留空 = 保留原值
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res
  try {
    const body = (await req.json().catch(() => ({}))) as {
      enabled?: boolean
      base_url?: string
      api_key?: string
      model?: string
      persona?: string
      proactive_enabled?: boolean
      cooldown_hours?: number
      max_unanswered?: number
    }

    const patch: Record<string, any> = {
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    }

    if (typeof body.enabled === "boolean") patch.enabled = body.enabled
    if (typeof body.proactive_enabled === "boolean") patch.proactive_enabled = body.proactive_enabled

    if (typeof body.base_url === "string") {
      const trimmed = body.base_url.trim().replace(/\/+$/, "")
      if (trimmed && !/^https?:\/\//i.test(trimmed)) {
        return NextResponse.json(
          { error: "base_url 必须以 http:// 或 https:// 开头" },
          { status: 400 },
        )
      }
      patch.base_url = trimmed
    }

    if (typeof body.model === "string") {
      const trimmed = body.model.trim()
      if (trimmed.length === 0) {
        return NextResponse.json({ error: "model 不能为空字符串" }, { status: 400 })
      }
      patch.model = trimmed
    }

    // persona 允许为空字符串（空 = 用代码默认人设）
    if (typeof body.persona === "string") patch.persona = body.persona.slice(0, 4000)

    // api_key 仅在传入非空时更新
    if (typeof body.api_key === "string" && body.api_key.trim().length > 0) {
      patch.api_key = body.api_key.trim()
    }

    if (typeof body.cooldown_hours === "number" && Number.isFinite(body.cooldown_hours)) {
      patch.cooldown_hours = Math.min(Math.max(Math.round(body.cooldown_hours), 0), 720)
    }
    if (typeof body.max_unanswered === "number" && Number.isFinite(body.max_unanswered)) {
      patch.max_unanswered = Math.min(Math.max(Math.round(body.max_unanswered), 0), 50)
    }

    // 至少一个真实字段（除了 updated_at/updated_by）
    const realKeys = Object.keys(patch).filter((k) => k !== "updated_at" && k !== "updated_by")
    if (realKeys.length === 0) {
      return NextResponse.json({ error: "没有可更新的字段" }, { status: 400 })
    }

    // upsert 到 id=1：先 update，命中 0 行则 insert（应对未插入默认行）
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("dm_ai_config")
      .update(patch)
      .eq("id", 1)
      .select()
      .maybeSingle()
    if (updateErr) throw updateErr

    if (!updated) {
      const insertRow = {
        id: 1,
        enabled: patch.enabled ?? false,
        base_url: patch.base_url ?? "https://api.deepseek.com/v1",
        api_key: patch.api_key ?? "",
        model: patch.model ?? "deepseek-chat",
        persona: patch.persona ?? "",
        proactive_enabled: patch.proactive_enabled ?? false,
        cooldown_hours: patch.cooldown_hours ?? 24,
        max_unanswered: patch.max_unanswered ?? 2,
        updated_at: patch.updated_at,
        updated_by: patch.updated_by,
      }
      const { error: insertErr } = await supabaseAdmin.from("dm_ai_config").insert([insertRow])
      if (insertErr) throw insertErr
    }

    const { data: latest } = await supabaseAdmin
      .from("dm_ai_config")
      .select(SELECT_COLS)
      .eq("id", 1)
      .maybeSingle()

    return NextResponse.json(latest ? shape(latest) : EMPTY)
  } catch (error: any) {
    console.error("[DM AI Config] PATCH 错误:", error)
    return NextResponse.json({ error: error.message || "更新失败" }, { status: 500 })
  }
}
