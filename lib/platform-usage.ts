// 平台用量自记：给没有官方用量查询 API 的平台（Resend 发信数 / 小米 MiMo token）
// 做本地计数，喂给管理面板「平台用量」的 Resend / MiMo 卡片。
//
// 设计：写入 public.platform_usage_log（service_role，绕 RLS）。
//   - 永不抛错、永不阻塞主流程：埋点处即使 await 也只是多等一次轻量 insert，
//     失败仅 console.warn。绝不能因为"记个数失败"影响发信或 AI 回复本身。
//   - 必须先跑 scripts/2026-06-21-platform-usage-stats.sql 建表 + 函数。
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let _client: SupabaseClient | null = null
function client(): SupabaseClient | null {
  if (_client) return _client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  _client = createClient(url, key, { auth: { persistSession: false } })
  return _client
}

/**
 * 记一笔平台用量。provider 如 'resend'|'mimo'，metric 如 'email'|'tokens'。
 * amount<=0 或无效（如 token 数取不到）直接跳过、不留废行。
 */
export async function logPlatformUsage(
  provider: string,
  metric: string,
  amount: number | undefined | null = 1,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const amt = Math.round(Number(amount))
    if (!Number.isFinite(amt) || amt <= 0) return
    const c = client()
    if (!c) return
    const { error } = await c
      .from("platform_usage_log")
      .insert({ provider, metric, amount: amt, meta: meta ?? null })
    if (error) console.warn("[platform-usage] 记录失败:", error.message)
  } catch (e) {
    console.warn("[platform-usage] 记录异常:", e instanceof Error ? e.message : e)
  }
}
