import { NextRequest, NextResponse } from "next/server"
import { requireAdmin, supabaseAdmin } from "@/lib/admin-auth"

// 平台用量聚合：把分散在各家平台的配额/用量收拢到一个接口，喂给管理面板「平台用量」tab。
// 设计要点：
//  - 每个平台一个独立 provider，全部并行 + 8s 超时 + 自带 try/catch；
//    任何一家挂掉/慢/未配置都只影响它自己那张卡片，绝不拖垮整页。
//  - 缺凭证 → status:"not_configured" + hint，告诉你缺什么、怎么配；不报错。
//  - 鉴权复用 lib/admin-auth 的 requireAdmin（与其它 admin API 一致）。
export const dynamic = "force-dynamic"

type Status = "ok" | "warn" | "critical" | "unknown" | "not_configured" | "error"

export type QuotaCard = {
  key: string
  name: string
  status: Status
  used: number | null
  limit: number | null
  unit: string
  percent: number | null
  period: string // 'daily' | 'monthly' | 'total' | ''
  detail: string
  hint?: string // 未配置/待接入时的下一步提示
  dashboardUrl: string
}

type CardBase = Pick<QuotaCard, "key" | "name" | "unit" | "period" | "dashboardUrl">

// 免费层额度（plan 依赖，升级套餐后按需改这里）
const LIMITS = {
  cloudflareWorkersPerDay: 100_000, // Workers Free：10万请求/天
  resendPerDay: 100, // Resend Free：100 封/天
  resendPerMonth: 3_000, // Resend Free：3000 封/月
  supabaseDbBytes: 500 * 1024 * 1024, // Free：500MB 数据库
  supabaseStorageBytes: 1024 * 1024 * 1024, // Free：1GB 存储
}

const FETCH_TIMEOUT = 8000

// ─── 小工具 ───────────────────────────────────────────────
function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : (v as number)
  return typeof n === "number" && isFinite(n) ? n : null
}
function pct(used: number, limit: number): number {
  if (!limit || limit <= 0) return 0
  return Math.min(999, Math.round((used / limit) * 100))
}
function statusFromPct(p: number | null): Status {
  if (p == null) return "unknown"
  if (p >= 90) return "critical"
  if (p >= 75) return "warn"
  return "ok"
}
function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(1) + "MB"
}
// 把原始返回压成短字符串放进 detail：首次加载就能看到真实字段，便于后续收紧解析
function summarize(o: unknown): string {
  try {
    const s = JSON.stringify(o)
    return s.length > 280 ? s.slice(0, 280) + "…" : s
  } catch {
    return ""
  }
}
function notConfigured(base: CardBase, hint: string): QuotaCard {
  return { ...base, status: "not_configured", used: null, limit: null, percent: null, detail: "", hint }
}
function errorCard(base: CardBase, e: unknown): QuotaCard {
  const msg = e instanceof Error ? e.message : String(e)
  return { ...base, status: "error", used: null, limit: null, percent: null, detail: (msg || "请求失败").slice(0, 200) }
}

// ─── Tavily：GET /usage（现有 TAVILY_API_KEY 直接可用）────────
async function tavilyCard(): Promise<QuotaCard> {
  const base: CardBase = { key: "tavily", name: "Tavily 搜索", unit: "credits", period: "monthly", dashboardUrl: "https://app.tavily.com/" }
  const key = process.env.TAVILY_API_KEY
  if (!key) return notConfigured(base, "未配置 TAVILY_API_KEY")
  try {
    const res = await fetch("https://api.tavily.com/usage", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      cache: "no-store",
    })
    const raw: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(raw?.error || `HTTP ${res.status}`)
    // 防御式解析：账户级 plan 用量优先，其次 key 级用量（字段名以首次返回为准）
    const acct = raw?.account ?? {}
    const keyUsage = raw?.key ?? {}
    const used = num(acct.plan_usage ?? acct.usage ?? keyUsage.usage)
    const limit = num(acct.plan_limit ?? acct.limit ?? keyUsage.limit)
    const p = used != null && limit != null ? pct(used, limit) : null
    return { ...base, status: statusFromPct(p), used, limit, percent: p, detail: summarize(raw) }
  } catch (e) {
    return errorCard(base, e)
  }
}

// ─── Brevo：GET /v3/account（需单独建 API key，与 SMTP 密码不同）──
async function brevoCard(): Promise<QuotaCard> {
  const base: CardBase = { key: "brevo", name: "Brevo 邮件", unit: "credits", period: "", dashboardUrl: "https://app.brevo.com/" }
  const key = process.env.BREVO_API_KEY
  if (!key) return notConfigured(base, "未配置 BREVO_API_KEY（注意：这是 Brevo 后台单独生成的 API key，不是你 SMTP 那串密码）")
  try {
    const res = await fetch("https://api.brevo.com/v3/account", {
      headers: { "api-key": key, accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      cache: "no-store",
    })
    const raw: any = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(raw?.message || `HTTP ${res.status}`)
    // plan 是数组，取发信额度条目（creditsType=sendLimit）；credits = 剩余可发数
    const plans: any[] = Array.isArray(raw?.plan) ? raw.plan : []
    const sendPlan = plans.find((p) => p?.creditsType === "sendLimit") || plans[0]
    const remaining = num(sendPlan?.credits)
    // Brevo 返回的是「剩余额度」而非已用，剩余越少越危险
    const status: Status = remaining == null ? "unknown" : remaining <= 20 ? "critical" : remaining <= 100 ? "warn" : "ok"
    return {
      ...base,
      status,
      used: null,
      limit: null,
      percent: null,
      detail: remaining != null ? `剩余 ${remaining} 封额度（${sendPlan?.type || "plan"}）` : summarize(raw),
    }
  } catch (e) {
    return errorCard(base, e)
  }
}

// ─── Cloudflare：GraphQL Analytics，今日 UTC Workers 请求数 ────
async function cloudflareCard(): Promise<QuotaCard> {
  const base: CardBase = { key: "cloudflare", name: "Cloudflare Workers", unit: "requests", period: "daily", dashboardUrl: "https://dash.cloudflare.com/" }
  const token = process.env.CF_API_TOKEN
  const account = process.env.CF_ACCOUNT_ID
  if (!token || !account) return notConfigured(base, "未配置 CF_API_TOKEN / CF_ACCOUNT_ID（需建一个 Account Analytics:Read 的只读 token）")
  try {
    const now = new Date()
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString()
    const until = now.toISOString()
    const query =
      "query($a:String!,$s:Time!,$u:Time!){viewer{accounts(filter:{accountTag:$a}){workersInvocationsAdaptive(limit:10000,filter:{datetime_geq:$s,datetime_leq:$u}){sum{requests errors}}}}}"
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { a: account, s: since, u: until } }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      cache: "no-store",
    })
    const raw: any = await res.json().catch(() => ({}))
    if (!res.ok || raw?.errors?.length) throw new Error(raw?.errors?.[0]?.message || `HTTP ${res.status}`)
    const nodes: any[] = raw?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []
    const used = nodes.reduce((s: number, n: any) => s + (num(n?.sum?.requests) || 0), 0)
    const errors = nodes.reduce((s: number, n: any) => s + (num(n?.sum?.errors) || 0), 0)
    const limit = LIMITS.cloudflareWorkersPerDay
    const p = pct(used, limit)
    return { ...base, status: statusFromPct(p), used, limit, percent: p, detail: `今日(UTC) ${used.toLocaleString()} 次请求，${errors} 次错误` }
  } catch (e) {
    return errorCard(base, e)
  }
}

// ─── Supabase：库/存储大小（只读 SQL 函数）。egress 无 API、本卡不含 ──
async function supabaseCard(): Promise<QuotaCard> {
  const base: CardBase = {
    key: "supabase",
    name: "Supabase 库/存储",
    unit: "MB",
    period: "total",
    // ⚠️ 改成你自己的 Supabase project ref（在 Supabase Dashboard 首页可看到）
    dashboardUrl: `https://supabase.com/dashboard/project/${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https:\/\/([^.]+)\..*$/, "$1") || "YOUR_PROJECT_REF"}/settings/billing`,
  }
  try {
    const { data, error } = await supabaseAdmin.rpc("admin_platform_storage_stats")
    if (error) {
      if ((error.message || "").toLowerCase().includes("function")) {
        return notConfigured(base, "未跑 scripts/2026-06-21-platform-usage-stats.sql（建只读统计函数后点亮本卡）")
      }
      throw new Error(error.message)
    }
    const d: any = data
    const dbBytes = num(d?.db_bytes) || 0
    const storageBytes = num(d?.storage_bytes) || 0
    const dbPct = pct(dbBytes, LIMITS.supabaseDbBytes)
    const stPct = pct(storageBytes, LIMITS.supabaseStorageBytes)
    const worst = Math.max(dbPct, stPct)
    return {
      ...base,
      status: statusFromPct(worst),
      used: Math.round((dbBytes + storageBytes) / 1048576),
      limit: Math.round((LIMITS.supabaseDbBytes + LIMITS.supabaseStorageBytes) / 1048576),
      percent: worst,
      detail: `库 ${mb(dbBytes)}/500MB(${dbPct}%) ｜ 存储 ${mb(storageBytes)}/1GB(${stPct}%) ｜ egress 无 API，请去 Dashboard 看`,
    }
  } catch (e) {
    return errorCard(base, e)
  }
}

// 自记用量统计（Resend 发信数 / MiMo token）：一次 RPC 取全，喂给下面两张卡。
// RPC 不存在（没跑 SQL 脚本）→ 返 null，两卡显示「未配置」并提示去跑脚本。
type UsageStats = {
  resend_day?: number
  resend_month?: number
  mimo_month_tokens?: number
  mimo_month_calls?: number
}
async function fetchUsageStats(): Promise<UsageStats | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc("admin_platform_usage_stats")
    if (error) return null
    return (data as UsageStats) ?? null
  } catch {
    return null
  }
}

// ─── Resend：无官方用量 API → 读自建发信日志（成功走 Resend 的发信计数）──
function resendCard(usage: UsageStats | null): QuotaCard {
  const base: CardBase = { key: "resend", name: "Resend 邮件", unit: "emails", period: "monthly", dashboardUrl: "https://resend.com/overview" }
  if (!usage) return notConfigured(base, "待跑 scripts/2026-06-21-platform-usage-stats.sql（建用量日志表 + 函数）后自动点亮")
  const day = num(usage.resend_day) || 0
  const month = num(usage.resend_month) || 0
  const dayPct = pct(day, LIMITS.resendPerDay)
  const monthPct = pct(month, LIMITS.resendPerMonth)
  const worst = Math.max(dayPct, monthPct)
  return {
    ...base,
    status: statusFromPct(worst),
    used: month,
    limit: LIMITS.resendPerMonth,
    percent: worst,
    detail: `今日 ${day}/${LIMITS.resendPerDay}(${dayPct}%) ｜ 本月 ${month}/${LIMITS.resendPerMonth}(${monthPct}%) ｜ 仅计走 Resend 成功的发信`,
  }
}

// ─── MiMo（自有 AI）：无硬额度（海量免费 token）→ 自记 token 仅作信息展示、不报警 ──
function mimoCard(usage: UsageStats | null): QuotaCard {
  const base: CardBase = { key: "mimo", name: "小米 MiMo（自有 AI）", unit: "tokens", period: "monthly", dashboardUrl: "https://platform.xiaomimimo.com/" }
  if (!usage) return notConfigured(base, "待跑 scripts/2026-06-21-platform-usage-stats.sql（建用量日志表 + 函数）后自动点亮")
  const tokens = num(usage.mimo_month_tokens) || 0
  const calls = num(usage.mimo_month_calls) || 0
  // 海量免费套餐、无硬额度 → 直接绿色「正常」+ token 数（不设百分比、不报警）
  return {
    ...base,
    status: "ok",
    used: tokens,
    limit: null,
    percent: null,
    detail: `本月 ${tokens.toLocaleString()} tokens / ${calls} 次调用（自记）｜海量免费套餐、无硬额度，仅供参考`,
  }
}

// 展示排序：越危险越靠前，未配置/待接入垫底
const STATUS_ORDER: Record<Status, number> = { critical: 0, error: 1, warn: 2, ok: 3, unknown: 4, not_configured: 5 }

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.res

  // provider 内部已全程 try/catch、不会 reject；自记统计与各 API 卡并行取
  const [live, usage] = await Promise.all([
    Promise.all([tavilyCard(), brevoCard(), cloudflareCard(), supabaseCard()]),
    fetchUsageStats(),
  ])
  const cards: QuotaCard[] = [...live, resendCard(usage), mimoCard(usage)]
  cards.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])

  return NextResponse.json({ cards, generatedAt: new Date().toISOString() })
}
