// components/admin/platform-quota-panel.tsx
"use client"

// 平台用量面板：管理面板「平台用量」tab 的内容。
// 一次性拉取 /api/admin/platform-quota（各家平台并行聚合），按危险度排序渲染成卡片。
// 鉴权走 supabase.auth.getSession() 取 token，Bearer 调 API（API 端 requireAdmin）。
// fetch 一律走 apiUrl()——兼容 Capacitor APK（相对路径在 WebView 里会打到 localhost）。
import { useCallback, useEffect, useState } from "react"
import { RefreshCw, ExternalLink, AlertTriangle, CheckCircle2, HelpCircle, Settings2, XCircle } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { cn } from "@/lib/utils"

type Status = "ok" | "warn" | "critical" | "unknown" | "not_configured" | "error"
type QuotaCard = {
  key: string
  name: string
  status: Status
  used: number | null
  limit: number | null
  unit: string
  percent: number | null
  period: string
  detail: string
  hint?: string
  dashboardUrl: string
}

// 状态 → 配色/文案/图标。配色沿用面板既有：lime 主色，险情走 amber/red。
const STATUS_META: Record<Status, { label: string; text: string; bar: string; ring: string; Icon: typeof CheckCircle2 }> = {
  critical: { label: "告急", text: "text-red-400", bar: "bg-red-500", ring: "border-red-500/40", Icon: AlertTriangle },
  error: { label: "异常", text: "text-orange-400", bar: "bg-orange-500", ring: "border-orange-500/40", Icon: XCircle },
  warn: { label: "偏高", text: "text-amber-300", bar: "bg-amber-400", ring: "border-amber-400/40", Icon: AlertTriangle },
  ok: { label: "正常", text: "text-lime-400", bar: "bg-lime-400", ring: "border-lime-400/30", Icon: CheckCircle2 },
  unknown: { label: "未知", text: "text-sky-300", bar: "bg-sky-400", ring: "border-sky-400/30", Icon: HelpCircle },
  not_configured: { label: "未配置", text: "text-white/40", bar: "bg-white/20", ring: "border-white/10", Icon: Settings2 },
}

function fmt(n: number | null): string {
  if (n == null) return "—"
  return n.toLocaleString()
}

export default function PlatformQuotaPanel() {
  const [cards, setCards] = useState<QuotaCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      const res = await fetch(apiUrl("/api/admin/platform-quota"), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `读取失败 (HTTP ${res.status})`)
      setCards(Array.isArray(data.cards) ? data.cards : [])
      setGeneratedAt(data.generatedAt || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取平台用量失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    // wrapper 只留布局：绝不挂 filter/opacity 动画，否则会废掉子卡片的 backdrop-filter
    // （祖先 filter 废子级毛玻璃那条坑）。进场动画下沉到「毛玻璃卡片本体」上。
    <div>
      {/* 顶部：说明 + 刷新 + 抓取时间。header 无毛玻璃、是卡片的兄弟节点，挂渐入安全 */}
      <div className="admin-tab-enter mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">平台配额 / 用量</h2>
          <p className="text-sm text-white/50">各家平台用量一处看全，避免忘了看导致超额停服。越危险的卡片越靠前。</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-sm text-white/80 transition hover:border-lime-400/60 hover:text-lime-300 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          刷新
        </button>
      </div>

      {generatedAt && (
        <p className="mb-3 text-xs text-white/35">抓取于 {new Date(generatedAt).toLocaleString()}</p>
      )}

      {error && (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {/* 卡片网格 */}
      {loading && cards.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-2xl border border-white/5 bg-white/[0.03]" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c, i) => {
            const meta = STATUS_META[c.status] || STATUS_META.unknown
            const Icon = meta.Icon
            const showBar = c.percent != null
            return (
              // 毛玻璃 + 高斯渐入挂同一元素（与 .admin-panel-glass.admin-tab-enter 既有用法一致，
              // backdrop-filter 先采样、blurFadeIn 的 filter 后作用，可共存）；逐卡 delay 做错落入场。
              <div
                key={c.key}
                className="admin-panel-glass admin-tab-enter relative flex flex-col overflow-hidden p-4"
                style={{ animationDelay: `${i * 0.06}s` }}
              >
                {/* 顶部细条：按危险度着色，作毛玻璃统一边框之外的状态提示 */}
                <span className={cn("absolute inset-x-0 top-0 h-[3px]", meta.bar)} />
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="font-medium text-white/90">{c.name}</span>
                  <span className={cn("inline-flex items-center gap-1 text-xs font-medium", meta.text)}>
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                  </span>
                </div>

                {/* 用量数字 */}
                <div className="mb-1 flex items-baseline gap-1.5">
                  {c.percent != null ? (
                    <span className={cn("text-2xl font-bold tabular-nums", meta.text)}>{c.percent}%</span>
                  ) : (
                    <span className="text-sm text-white/50">{c.detail ? "" : "—"}</span>
                  )}
                  {c.used != null && c.limit != null && (
                    <span className="text-xs text-white/40">
                      {fmt(c.used)} / {fmt(c.limit)} {c.unit}
                      {c.period ? ` · ${c.period}` : ""}
                    </span>
                  )}
                </div>

                {/* 百分比条 */}
                {showBar && (
                  <div className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className={cn("h-full rounded-full transition-all", meta.bar)} style={{ width: `${Math.min(100, c.percent ?? 0)}%` }} />
                  </div>
                )}

                {/* 详情 / 配置提示 */}
                {c.detail && <p className="text-xs leading-relaxed text-white/55">{c.detail}</p>}
                {c.hint && <p className="mt-1 text-xs leading-relaxed text-amber-300/70">⚙ {c.hint}</p>}

                {/* 直达账单页 */}
                <a
                  href={c.dashboardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-auto inline-flex items-center gap-1 pt-3 text-xs text-white/40 transition hover:text-lime-300"
                >
                  打开控制台 <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
