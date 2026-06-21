// components/admin/moderation-panel.tsx
"use client"

// 内容审核面板：顶部三个子区切换（审核队列 / 敏感词库 / 白名单），默认显示审核队列。
// 风格照搬同目录 mengmegzi-agent-panel.tsx + app/admin/page.tsx 的「admins」tab：
// admin-panel-glass 卡片、bg-white/5 border-white/15 输入框、lime 色按钮、Switch lime 覆盖。
// 鉴权一律走 supabase.auth.getSession() 取 token，Bearer 调 /api/admin/moderation/*。
// API 契约见 app/api/admin/moderation/{queue,words,allowlist}/route.ts。

import { useEffect, useState, useCallback } from "react"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  ShieldAlert,
  ListChecks,
  BookText,
  ShieldCheck,
  RefreshCw,
  Trash2,
  Check,
  Plus,
  Search,
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"

// ─── 常量 ──────────────────────────────────────────────────
// 分类与 app/api/admin/moderation/guard.ts 的 CATEGORIES 保持一致（那是服务端导出，前端复刻一份）。
const CATEGORIES = ["政治", "色情", "辱骂", "广告", "违法"] as const
type Category = (typeof CATEGORIES)[number]

// queue.table_name → 中文（取值见 queue/route.ts removeOriginalContent）
const TABLE_LABEL: Record<string, string> = {
  posts: "帖子",
  comments: "评论",
  live_comments: "弹幕",
}

type SubTab = "queue" | "words" | "allowlist"

const SUB_TABS: { value: SubTab; label: string; icon: typeof ListChecks }[] = [
  { value: "queue", label: "审核队列", icon: ListChecks },
  { value: "words", label: "敏感词库", icon: BookText },
  { value: "allowlist", label: "白名单", icon: ShieldCheck },
]

// ─── 数据类型（对齐 API 返回字段） ───────────────────────────
interface QueueItem {
  id: string
  table_name: string
  record_id: string
  user_id: string | null
  username: string | null
  content: string
  category: string | null
  matched: string | null
  source: string | null
  status: string
  created_at: string
}

interface WordRow {
  id: string
  word: string
  category: string
  action: string
  enabled: boolean
  created_at: string
}

interface AllowRow {
  id: string
  phrase: string
  note: string | null
  enabled: boolean
  created_at: string
}

// ─── 鉴权头 ────────────────────────────────────────────────
async function authHeaders(): Promise<Record<string, string>> {
  const { data: s } = await supabase.auth.getSession()
  const token = s?.session?.access_token
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// 列表加载骨架（page.tsx 的 SkeletonRows 未导出，这里内联一份等价实现）
function SkeletonRows({ rows = 3, cols = 3 }: { rows?: number; cols?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="grid gap-4 p-4 border-b border-white/5 last:border-0"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
        >
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-4 rounded bg-white/10 animate-pulse" />
          ))}
        </div>
      ))}
    </div>
  )
}

// 子区切换 chip（选中=lime 实心，未选=毛玻璃描边）；与 agent 面板 chipCls 同语言
function tabCls(active: boolean): string {
  return `inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm border transition-colors ${
    active
      ? "bg-lime-500/90 text-black border-lime-400"
      : "bg-white/5 text-white/80 border-white/15 hover:bg-white/10"
  }`
}

// 原生 select 统一风格（项目 ui 里虽有 Select，但为零额外依赖 + 表单简单，这里用原生）
const SELECT_CLS =
  "h-10 rounded-md border border-white/15 bg-white/5 px-3 text-sm text-white focus:border-lime-400/50 focus:outline-none [&>option]:bg-neutral-900 [&>option]:text-white"

const INPUT_CLS =
  "bg-white/5 border-white/15 text-white placeholder:text-white/40 focus:border-lime-400/50"

export default function ModerationPanel() {
  const [tab, setTab] = useState<SubTab>("queue")

  return (
    <div className="space-y-4">
      {/* 顶部子区切换 */}
      <div className="flex flex-wrap items-center gap-2">
        {SUB_TABS.map((t) => {
          const Icon = t.icon
          return (
            <button key={t.value} type="button" onClick={() => setTab(t.value)} className={tabCls(tab === t.value)}>
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === "queue" && <QueueSection />}
      {tab === "words" && <WordsSection />}
      {tab === "allowlist" && <AllowlistSection />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// 1) 审核队列
// ════════════════════════════════════════════════════════════
function QueueSection() {
  const { toast } = useToast()
  const [items, setItems] = useState<QueueItem[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiUrl("/api/admin/moderation/queue?status=pending&limit=100&offset=0"), {
        headers: await authHeaders(),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "加载失败", description: data.error || "请重试", variant: "destructive" })
        return
      }
      setItems(Array.isArray(data.items) ? data.items : [])
      setPendingCount(data.pendingCount ?? 0)
    } catch {
      toast({ title: "加载失败", description: "网络异常", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  async function act(id: string, action: "approve" | "remove") {
    if (action === "remove" && !window.confirm("确定删除该内容？此操作不可撤销（原帖/评论/弹幕将被删除）。")) {
      return
    }
    setBusyId(id)
    try {
      const res = await fetch(apiUrl("/api/admin/moderation/queue"), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ id, action }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "操作失败", description: data.error || "请重试", variant: "destructive" })
        return
      }
      // 成功后从列表移除该行 + 角标 -1
      setItems((prev) => prev.filter((it) => it.id !== id))
      setPendingCount((c) => Math.max(0, c - 1))
      toast({ title: action === "remove" ? "已删除内容" : "已放行" })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card className="admin-panel-glass">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ShieldAlert className="h-5 w-5 text-lime-400" />
              审核队列
            </CardTitle>
            <CardDescription>命中敏感词被标记（flag）的内容，逐条放行或删除</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="text-right" title="待审内容总数">
              <div className="text-3xl font-bold leading-none text-lime-400 tabular-nums">{pendingCount}</div>
              <div className="mt-1 text-xs text-gray-500">待审</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={load}
              className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-xl border border-white/10">
          {loading && items.length === 0 ? (
            <SkeletonRows rows={4} cols={2} />
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-gray-500">暂无待审内容</div>
          ) : (
            <div className="divide-y divide-white/10">
              {items.map((it) => (
                <div key={it.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      {/* 内容快照（可较长，截断显示） */}
                      <p className="line-clamp-3 break-words text-sm text-white/90">{it.content || "（空内容）"}</p>
                      {/* 元信息行 */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50">
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">
                          {TABLE_LABEL[it.table_name] || it.table_name}
                        </span>
                        {it.category && <span>分类：{it.category}</span>}
                        {it.matched && (
                          <span className="text-amber-300/90">
                            命中：<span className="break-all">{it.matched}</span>
                          </span>
                        )}
                        {it.source && (
                          <span>来源：{it.source === "ai" ? "AI" : it.source === "keyword" ? "关键词" : it.source}</span>
                        )}
                        <span>
                          作者：{it.username || (it.user_id ? `用户_${it.user_id.substring(0, 6)}` : "未知")}
                        </span>
                        <span>{new Date(it.created_at).toLocaleString("zh-CN")}</span>
                      </div>
                    </div>
                    {/* 操作按钮 */}
                    <div className="flex shrink-0 flex-col items-stretch gap-2">
                      <Button
                        size="sm"
                        disabled={busyId === it.id}
                        onClick={() => act(it.id, "approve")}
                        className="bg-lime-500/90 text-black hover:bg-lime-400"
                      >
                        <Check className="mr-1 h-4 w-4" />
                        放行
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busyId === it.id}
                        onClick={() => act(it.id, "remove")}
                        className="bg-red-600/90 hover:bg-red-600"
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        删除内容
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ════════════════════════════════════════════════════════════
// 2) 敏感词库
// ════════════════════════════════════════════════════════════
const WORDS_PAGE = 200

function WordsSection() {
  const { toast } = useToast()
  const [words, setWords] = useState<WordRow[]>([])
  const [byCategory, setByCategory] = useState<Record<string, number>>({})
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // 过滤 + 搜索
  const [filterCat, setFilterCat] = useState<string>("") // "" = 全部
  const [q, setQ] = useState("")

  // 新增表单
  const [newWord, setNewWord] = useState("")
  const [newCat, setNewCat] = useState<Category>("政治")
  const [newAction, setNewAction] = useState<"block" | "flag">("block")
  const [adding, setAdding] = useState(false)

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      const params = new URLSearchParams()
      if (filterCat) params.set("category", filterCat)
      if (q.trim()) params.set("q", q.trim())
      params.set("limit", String(WORDS_PAGE))
      params.set("offset", String(offset))
      const res = await fetch(apiUrl(`/api/admin/moderation/words?${params.toString()}`), {
        headers: await authHeaders(),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "加载失败", description: data.error || "请重试", variant: "destructive" })
        return
      }
      const list: WordRow[] = Array.isArray(data.words) ? data.words : []
      setWords((prev) => (append ? [...prev, ...list] : list))
      setTotal(data.total ?? 0)
      setByCategory(data.byCategory ?? {})
    },
    [filterCat, q, toast],
  )

  // 过滤条件变化 → 从头重载（首屏 + 搜索/分类切换共用）
  useEffect(() => {
    setLoading(true)
    fetchPage(0, false).finally(() => setLoading(false))
  }, [fetchPage])

  async function loadMore() {
    setLoadingMore(true)
    try {
      await fetchPage(words.length, true)
    } finally {
      setLoadingMore(false)
    }
  }

  async function addWord() {
    const word = newWord.trim()
    if (!word) return
    setAdding(true)
    try {
      const res = await fetch(apiUrl("/api/admin/moderation/words"), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ word, category: newCat, action: newAction }),
      })
      const data = await res.json()
      if (res.status === 409) {
        toast({ title: "该词已存在", variant: "destructive" })
        return
      }
      if (!res.ok) {
        toast({ title: "添加失败", description: data.error || "请重试", variant: "destructive" })
        return
      }
      // 新行直接前插（POST 返回 { word })，并刷新分类计数
      if (data.word) setWords((prev) => [data.word as WordRow, ...prev])
      setByCategory((m) => ({ ...m, [newCat]: (m[newCat] || 0) + 1 }))
      setTotal((t) => t + 1)
      setNewWord("")
      toast({ title: "已添加" })
    } finally {
      setAdding(false)
    }
  }

  // PATCH：切换 action（block/flag）或启停
  async function patchWord(id: string, patch: { action?: "block" | "flag"; enabled?: boolean }) {
    // 乐观更新
    setWords((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)))
    const res = await fetch(apiUrl("/api/admin/moderation/words"), {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify({ id, ...patch }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: "更新失败", description: data.error || "请重试", variant: "destructive" })
      // 回滚：从服务器重拉当前页
      fetchPage(0, false)
    }
  }

  async function deleteWord(id: string, word: string) {
    if (!window.confirm(`删除敏感词「${word}」？`)) return
    const res = await fetch(apiUrl(`/api/admin/moderation/words?id=${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: await authHeaders(),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: "删除失败", description: data.error || "请重试", variant: "destructive" })
      return
    }
    const removed = words.find((w) => w.id === id)
    setWords((prev) => prev.filter((w) => w.id !== id))
    setTotal((t) => Math.max(0, t - 1))
    if (removed) setByCategory((m) => ({ ...m, [removed.category]: Math.max(0, (m[removed.category] || 1) - 1) }))
    toast({ title: "已删除" })
  }

  const allCount = Object.values(byCategory).reduce((a, b) => a + b, 0)

  return (
    <Card className="admin-panel-glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <BookText className="h-5 w-5 text-lime-400" />
          敏感词库
        </CardTitle>
        <CardDescription>命中即按 action 处理：block 直接删除、flag 入审核队列</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 分类筛选 + 搜索 */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setFilterCat("")} className={tabCls(filterCat === "")}>
            全部 {allCount ? `(${allCount})` : ""}
          </button>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" onClick={() => setFilterCat(c)} className={tabCls(filterCat === c)}>
              {c} {byCategory[c] ? `(${byCategory[c]})` : "(0)"}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              placeholder="搜索词…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={`w-48 pl-8 ${INPUT_CLS}`}
            />
          </div>
        </div>

        {/* 新增表单 */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <Input
            placeholder="新增敏感词"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addWord()
            }}
            className={`w-48 ${INPUT_CLS}`}
          />
          <select value={newCat} onChange={(e) => setNewCat(e.target.value as Category)} className={SELECT_CLS}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={newAction}
            onChange={(e) => setNewAction(e.target.value as "block" | "flag")}
            className={SELECT_CLS}
          >
            <option value="block">block（删除）</option>
            <option value="flag">flag（入队）</option>
          </select>
          <Button
            disabled={adding || !newWord.trim()}
            onClick={addWord}
            className="bg-lime-500/90 text-black hover:bg-lime-400"
          >
            <Plus className="mr-1 h-4 w-4" />
            {adding ? "添加中…" : "添加"}
          </Button>
        </div>

        {/* 列表 */}
        <div className="rounded-xl border border-white/10">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 border-b border-white/10 p-3 text-sm font-medium text-gray-400">
            <div>词 / 分类</div>
            <div className="w-24 text-center">处理</div>
            <div className="w-16 text-center">启用</div>
            <div className="w-16 text-right">操作</div>
            <div className="w-0" />
          </div>
          {loading && words.length === 0 ? (
            <SkeletonRows rows={4} cols={4} />
          ) : words.length === 0 ? (
            <div className="p-8 text-center text-gray-500">暂无敏感词</div>
          ) : (
            words.map((w) => (
              <div
                key={w.id}
                className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 border-b border-white/10 p-3 last:border-0"
              >
                <div className="min-w-0">
                  <span className="break-all text-white">{w.word}</span>
                  <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-xs text-white/60">{w.category}</span>
                </div>
                {/* 处理方式切换：block ↔ flag */}
                <select
                  value={w.action}
                  onChange={(e) => patchWord(w.id, { action: e.target.value as "block" | "flag" })}
                  className={`${SELECT_CLS} w-24`}
                >
                  <option value="block">删除</option>
                  <option value="flag">入队</option>
                </select>
                {/* 启停 */}
                <div className="flex w-16 justify-center">
                  <Switch
                    checked={w.enabled}
                    onCheckedChange={(v) => patchWord(w.id, { enabled: v })}
                    className="data-[state=checked]:bg-lime-500 data-[state=unchecked]:bg-white/20"
                  />
                </div>
                {/* 删除 */}
                <div className="flex w-16 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteWord(w.id, w.word)}
                    className="text-red-400 hover:bg-red-900/20 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="w-0" />
              </div>
            ))
          )}
        </div>

        {/* 分页：加载更多 */}
        {words.length > 0 && words.length < total && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              disabled={loadingMore}
              onClick={loadMore}
              className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              {loadingMore ? "加载中…" : `加载更多（已显示 ${words.length} / ${total}）`}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ════════════════════════════════════════════════════════════
// 3) 白名单（豁免词）
// ════════════════════════════════════════════════════════════
function AllowlistSection() {
  const { toast } = useToast()
  const [list, setList] = useState<AllowRow[]>([])
  const [loading, setLoading] = useState(true)

  const [newPhrase, setNewPhrase] = useState("")
  const [newNote, setNewNote] = useState("")
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiUrl("/api/admin/moderation/allowlist"), { headers: await authHeaders() })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "加载失败", description: data.error || "请重试", variant: "destructive" })
        return
      }
      setList(Array.isArray(data.allowlist) ? data.allowlist : [])
    } catch {
      toast({ title: "加载失败", description: "网络异常", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  async function addItem() {
    const phrase = newPhrase.trim()
    if (!phrase) return
    setAdding(true)
    try {
      const res = await fetch(apiUrl("/api/admin/moderation/allowlist"), {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ phrase, note: newNote.trim() || null }),
      })
      const data = await res.json()
      if (res.status === 409) {
        toast({ title: "该豁免词已存在", variant: "destructive" })
        return
      }
      if (!res.ok) {
        toast({ title: "添加失败", description: data.error || "请重试", variant: "destructive" })
        return
      }
      // POST 返回 { item }
      if (data.item) setList((prev) => [data.item as AllowRow, ...prev])
      setNewPhrase("")
      setNewNote("")
      toast({ title: "已添加" })
    } finally {
      setAdding(false)
    }
  }

  async function toggleEnabled(id: string, enabled: boolean) {
    setList((prev) => prev.map((it) => (it.id === id ? { ...it, enabled } : it)))
    const res = await fetch(apiUrl("/api/admin/moderation/allowlist"), {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify({ id, enabled }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: "更新失败", description: data.error || "请重试", variant: "destructive" })
      load()
    }
  }

  async function deleteItem(id: string, phrase: string) {
    if (!window.confirm(`删除豁免词「${phrase}」？`)) return
    const res = await fetch(apiUrl(`/api/admin/moderation/allowlist?id=${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: await authHeaders(),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast({ title: "删除失败", description: data.error || "请重试", variant: "destructive" })
      return
    }
    setList((prev) => prev.filter((it) => it.id !== id))
    toast({ title: "已删除" })
  }

  return (
    <Card className="admin-panel-glass">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <ShieldCheck className="h-5 w-5 text-lime-400" />
          白名单（豁免词）
        </CardTitle>
        <CardDescription>
          命中敏感词但整体落在豁免词内则放行，用来消除「大约 / 鞭炮」这类误杀
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 新增表单 */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <Input
            placeholder="豁免词"
            value={newPhrase}
            onChange={(e) => setNewPhrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addItem()
            }}
            className={`w-48 ${INPUT_CLS}`}
          />
          <Input
            placeholder="备注（可选）"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addItem()
            }}
            className={`w-56 ${INPUT_CLS}`}
          />
          <Button
            disabled={adding || !newPhrase.trim()}
            onClick={addItem}
            className="bg-lime-500/90 text-black hover:bg-lime-400"
          >
            <Plus className="mr-1 h-4 w-4" />
            {adding ? "添加中…" : "添加"}
          </Button>
        </div>

        {/* 列表 */}
        <div className="rounded-xl border border-white/10">
          <div className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-4 border-b border-white/10 p-3 text-sm font-medium text-gray-400">
            <div>豁免词</div>
            <div>备注</div>
            <div className="w-16 text-center">启用</div>
            <div className="w-16 text-right">操作</div>
          </div>
          {loading && list.length === 0 ? (
            <SkeletonRows rows={3} cols={4} />
          ) : list.length === 0 ? (
            <div className="p-8 text-center text-gray-500">暂无豁免词</div>
          ) : (
            list.map((it) => (
              <div
                key={it.id}
                className="grid grid-cols-[1fr_1fr_auto_auto] items-center gap-4 border-b border-white/10 p-3 last:border-0"
              >
                <div className="break-all text-white">{it.phrase}</div>
                <div className="break-all text-white/60">{it.note || "—"}</div>
                <div className="flex w-16 justify-center">
                  <Switch
                    checked={it.enabled}
                    onCheckedChange={(v) => toggleEnabled(it.id, v)}
                    className="data-[state=checked]:bg-lime-500 data-[state=unchecked]:bg-white/20"
                  />
                </div>
                <div className="flex w-16 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteItem(it.id, it.phrase)}
                    className="text-red-400 hover:bg-red-900/20 hover:text-red-300"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
