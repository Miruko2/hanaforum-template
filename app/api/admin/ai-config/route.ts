import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// 把 api_key 掩码：sk-1234567890abcdef → sk-****cdef
// 只回前 3 + 后 4 位，中间一律 ****
function maskApiKey(raw: string): string {
  if (!raw) return ""
  if (raw.length <= 8) return "****"
  return `${raw.slice(0, 3)}****${raw.slice(-4)}`
}

// 鉴权：必须是登录用户，且在 admin_users 表里
async function requireAdmin(
  req: NextRequest,
): Promise<{ ok: true; userId: string } | { ok: false; res: NextResponse }> {
  const authHeader = req.headers.get("authorization") || ""
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : ""

  if (!token) {
    return {
      ok: false,
      res: NextResponse.json({ error: "未登录" }, { status: 401 }),
    }
  }

  const { data: authData, error: authError } =
    await supabaseAdmin.auth.getUser(token)
  if (authError || !authData?.user) {
    return {
      ok: false,
      res: NextResponse.json({ error: "认证失败或已过期" }, { status: 401 }),
    }
  }

  // 校验是否管理员
  const { data: adminRow, error: adminErr } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", authData.user.id)
    .maybeSingle()

  if (adminErr) {
    console.error("[AI Config] 管理员查询错误:", adminErr)
    return {
      ok: false,
      res: NextResponse.json({ error: "服务器错误" }, { status: 500 }),
    }
  }

  if (!adminRow) {
    return {
      ok: false,
      res: NextResponse.json({ error: "无权限（非管理员）" }, { status: 403 }),
    }
  }

  return { ok: true, userId: authData.user.id }
}

// GET: 返回当前配置（api_key 掩码）
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  try {
    const { data, error } = await supabaseAdmin
      .from("ai_config")
      .select("base_url, api_key, model, whitelist_enabled, updated_at")
      .eq("id", 1)
      .maybeSingle()

    if (error) throw error

    // 表不存在或没数据，返回空配置（前端能提示"未配置"）
    if (!data) {
      return NextResponse.json({
        base_url: "",
        api_key_masked: "",
        api_key_set: false,
        model: "",
        // 字段缺失（迁移没跑过）默认 true，保持白名单生效
        whitelist_enabled: true,
        updated_at: null,
      })
    }

    return NextResponse.json({
      base_url: data.base_url || "",
      api_key_masked: maskApiKey(data.api_key || ""),
      api_key_set: !!data.api_key,
      model: data.model || "",
      // null/undefined 兜底 true，与 ai-reply 路由的兜底语义一致
      whitelist_enabled:
        typeof data.whitelist_enabled === "boolean"
          ? data.whitelist_enabled
          : true,
      updated_at: data.updated_at,
    })
  } catch (error: any) {
    console.error("[AI Config] GET 错误:", error)
    return NextResponse.json(
      { error: error.message || "查询失败" },
      { status: 500 },
    )
  }
}

// PATCH: 更新配置
// 请求体：{ base_url?: string, api_key?: string, model?: string }
// api_key 留空或不传 → 保留原值
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  try {
    const body = await req.json().catch(() => ({}))
    const { base_url, api_key, model, whitelist_enabled } = body as {
      base_url?: string
      api_key?: string
      model?: string
      whitelist_enabled?: boolean
    }

    // 至少要传一个字段
    if (
      base_url === undefined &&
      api_key === undefined &&
      model === undefined &&
      whitelist_enabled === undefined
    ) {
      return NextResponse.json(
        { error: "没有可更新的字段" },
        { status: 400 },
      )
    }

    // 组装更新对象
    const patch: Record<string, any> = {
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    }

    if (typeof base_url === "string") {
      const trimmed = base_url.trim().replace(/\/+$/, "") // 去掉末尾斜杠
      if (trimmed && !/^https?:\/\//i.test(trimmed)) {
        return NextResponse.json(
          { error: "base_url 必须以 http:// 或 https:// 开头" },
          { status: 400 },
        )
      }
      patch.base_url = trimmed
    }

    if (typeof model === "string") {
      const trimmed = model.trim()
      if (trimmed.length === 0) {
        return NextResponse.json(
          { error: "model 不能为空字符串" },
          { status: 400 },
        )
      }
      patch.model = trimmed
    }

    // api_key 只有在传入非空字符串时才更新；空字符串/undefined 保留原值
    if (typeof api_key === "string" && api_key.trim().length > 0) {
      patch.api_key = api_key.trim()
    }

    // 白名单开关：严格要求 boolean，避免 truthy/falsy 误判
    if (typeof whitelist_enabled === "boolean") {
      patch.whitelist_enabled = whitelist_enabled
    }

    // upsert 到 id=1 这一行
    // 先尝试 update，更新到 0 行就回退 insert（应对建表后未插入默认行的情况）
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("ai_config")
      .update(patch)
      .eq("id", 1)
      .select()
      .maybeSingle()

    if (updateErr) throw updateErr

    if (!updated) {
      // 默认行不存在，做一次插入
      const insertRow = {
        id: 1,
        base_url: patch.base_url ?? "https://api.deepseek.com/v1",
        api_key: patch.api_key ?? "",
        model: patch.model ?? "deepseek-chat",
        // 没显式传 → 用 DB 默认值 true（与 SQL 迁移保持一致）
        whitelist_enabled:
          typeof patch.whitelist_enabled === "boolean"
            ? patch.whitelist_enabled
            : true,
        updated_at: patch.updated_at,
        updated_by: patch.updated_by,
      }
      const { error: insertErr } = await supabaseAdmin
        .from("ai_config")
        .insert([insertRow])
      if (insertErr) throw insertErr
    }

    // 回填最新数据（api_key 掩码）
    const { data: latest } = await supabaseAdmin
      .from("ai_config")
      .select("base_url, api_key, model, whitelist_enabled, updated_at")
      .eq("id", 1)
      .maybeSingle()

    return NextResponse.json({
      base_url: latest?.base_url || "",
      api_key_masked: maskApiKey(latest?.api_key || ""),
      api_key_set: !!latest?.api_key,
      model: latest?.model || "",
      whitelist_enabled:
        typeof latest?.whitelist_enabled === "boolean"
          ? latest.whitelist_enabled
          : true,
      updated_at: latest?.updated_at || null,
    })
  } catch (error: any) {
    console.error("[AI Config] PATCH 错误:", error)
    return NextResponse.json(
      { error: error.message || "更新失败" },
      { status: 500 },
    )
  }
}
