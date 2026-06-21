// components/admin/friend-links-panel.tsx
"use client"

// 友链管理面板：管理面板「友链」tab 的内容（也被 /admin/friend-links 直链页复用）。
// 上半「待处理申请」一键 通过上墙/拒绝/垃圾；下半 手动增删改 + 上下移排序 + 显示/隐藏（两分区）。
// 鉴权走 supabase.auth.getSession() 取 token，Bearer 调 /api/admin/friend-links*（API 端 requireAdmin）。
// fetch 一律走 apiUrl()——兼容 Capacitor APK（相对路径在 WebView 里会打到 localhost）。
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  Check, X, Trash2, Eye, EyeOff, ChevronUp, ChevronDown, Plus, Pencil,
  Loader2, ExternalLink, Inbox, ShieldAlert,
} from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type Category = "friend" | "nav"
type FriendLinkRow = {
  id: string
  name: string
  url: string
  description: string | null
  icon_url: string | null
  tag: string | null
  category: Category
  sort_order: number
  is_visible: boolean
}
type SubmissionRow = {
  id: string
  site_name: string
  site_url: string
  icon_url: string | null
  description: string | null
  contact: string
  status: string
  created_at: string
}
type Draft = {
  name: string
  url: string
  description: string
  icon_url: string
  tag: string
  category: Category
}

const EMPTY_DRAFT: Draft = { name: "", url: "", description: "", icon_url: "", tag: "", category: "friend" }
const CAT_LABEL: Record<Category, string> = { friend: "朋友的小站", nav: "二次元 · ACG 导航" }
const inputCls =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 placeholder:text-white/30 outline-none transition focus:border-lime-400/60"

// 加载占位骨架：壳层即时渲染、数据区先占位，避免整面板被 spinner 阻塞
// （对齐管理面板既有的「非阻塞壳层 + 列表骨架」做法）。
function SkeletonRows({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
      ))}
    </div>
  )
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

export default function FriendLinksPanel() {
  const { toast } = useToast()

  const [links, setLinks] = useState<FriendLinkRow[]>([])
  const [subs, setSubs] = useState<SubmissionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT)
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const h = await authHeaders()
      const [r1, r2] = await Promise.all([
        fetch(apiUrl("/api/admin/friend-links"), { headers: h }),
        fetch(apiUrl("/api/admin/friend-links/submissions?status=pending"), { headers: h }),
      ])
      const d1 = await r1.json().catch(() => ({}))
      const d2 = await r2.json().catch(() => ({}))
      if (!r1.ok) throw new Error(d1.error || "读取友链失败")
      setLinks(d1.links ?? [])
      setSubs(d2.submissions ?? [])
    } catch (e: any) {
      toast({ title: "加载失败", description: e?.message || "请稍后重试", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  // —— 申请审核 ——
  async function actSubmission(id: string, action: "approve" | "reject" | "spam") {
    setBusyId(id)
    try {
      const h = await authHeaders()
      const res = await fetch(apiUrl("/api/admin/friend-links/submissions"), {
        method: "PATCH",
        headers: h,
        body: JSON.stringify({ id, action }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || "操作失败")
      setSubs((prev) => prev.filter((s) => s.id !== id))
      if (action === "approve") {
        toast({ title: "已通过并上墙 ✨", description: "已加到「朋友的小站」，/links 即时刷新" })
        load()
      } else {
        toast({ title: action === "spam" ? "已标记垃圾" : "已拒绝" })
      }
    } catch (e: any) {
      toast({ title: "操作失败", description: e?.message, variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  // —— 新增友链 ——
  async function addLink() {
    if (!addDraft.name.trim() || !addDraft.url.trim()) {
      toast({ title: "站名和网址必填", variant: "destructive" })
      return
    }
    setAdding(true)
    try {
      const h = await authHeaders()
      const res = await fetch(apiUrl("/api/admin/friend-links"), {
        method: "POST",
        headers: h,
        body: JSON.stringify(addDraft),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || "新增失败")
      setAddDraft({ ...EMPTY_DRAFT, category: addDraft.category })
      toast({ title: "已添加" })
      load()
    } catch (e: any) {
      toast({ title: "新增失败", description: e?.message, variant: "destructive" })
    } finally {
      setAdding(false)
    }
  }

  // —— 编辑友链 ——
  function startEdit(link: FriendLinkRow) {
    setEditingId(link.id)
    setEditDraft({
      name: link.name,
      url: link.url,
      description: link.description ?? "",
      icon_url: link.icon_url ?? "",
      tag: link.tag ?? "",
      category: link.category,
    })
  }
  async function saveEdit() {
    if (!editingId) return
    setBusyId(editingId)
    try {
      const h = await authHeaders()
      const res = await fetch(apiUrl("/api/admin/friend-links"), {
        method: "PATCH",
        headers: h,
        body: JSON.stringify({ id: editingId, ...editDraft }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || "保存失败")
      setEditingId(null)
      toast({ title: "已保存" })
      load()
    } catch (e: any) {
      toast({ title: "保存失败", description: e?.message, variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  async function patchLink(id: string, patch: Record<string, unknown>) {
    const h = await authHeaders()
    const res = await fetch(apiUrl("/api/admin/friend-links"), {
      method: "PATCH",
      headers: h,
      body: JSON.stringify({ id, ...patch }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error || "操作失败")
    }
  }

  async function toggleVisible(link: FriendLinkRow) {
    setBusyId(link.id)
    try {
      await patchLink(link.id, { is_visible: !link.is_visible })
      setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, is_visible: !l.is_visible } : l)))
    } catch (e: any) {
      toast({ title: "操作失败", description: e?.message, variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  async function deleteLink(link: FriendLinkRow) {
    if (!window.confirm(`确定删除友链「${link.name}」？`)) return
    setBusyId(link.id)
    try {
      const h = await authHeaders()
      const res = await fetch(apiUrl(`/api/admin/friend-links?id=${encodeURIComponent(link.id)}`), {
        method: "DELETE",
        headers: h,
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || "删除失败")
      }
      setLinks((prev) => prev.filter((l) => l.id !== link.id))
      toast({ title: "已删除" })
    } catch (e: any) {
      toast({ title: "删除失败", description: e?.message, variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  // 同分区内上/下移：与相邻项交换 sort_order
  async function move(link: FriendLinkRow, dir: -1 | 1) {
    const sameCat = links
      .filter((l) => l.category === link.category)
      .sort((a, b) => a.sort_order - b.sort_order)
    const idx = sameCat.findIndex((l) => l.id === link.id)
    const swapWith = sameCat[idx + dir]
    if (!swapWith) return
    setBusyId(link.id)
    try {
      await Promise.all([
        patchLink(link.id, { sort_order: swapWith.sort_order }),
        patchLink(swapWith.id, { sort_order: link.sort_order }),
      ])
      load()
    } catch (e: any) {
      toast({ title: "排序失败", description: e?.message, variant: "destructive" })
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="admin-tab-enter flex items-center justify-between gap-3">
        <p className="text-sm text-white/50">审核申请、手动增删改友链，改动即时同步到 /links</p>
        <Link
          href="/links"
          target="_blank"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/70 transition hover:text-lime-300"
        >
          看 /links <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* —— 待处理申请 —— */}
      <section className="admin-panel-glass admin-tab-enter space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Inbox className="h-5 w-5 text-lime-400" />
          <h2 className="text-lg font-bold">待处理申请</h2>
          <span className="rounded-full bg-lime-400/15 px-2 py-0.5 text-xs text-lime-300">{loading ? "…" : subs.length}</span>
        </div>
        {loading ? (
          <SkeletonRows rows={1} />
        ) : subs.length === 0 ? (
          <p className="py-4 text-center text-sm text-white/40">暂无待处理的友链申请</p>
        ) : (
          <div className="space-y-3">
            {subs.map((s) => (
              <div key={s.id} className="admin-inset-glass p-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-bold text-white/90">{s.site_name}</p>
                  <a
                    href={s.site_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 break-all text-sm text-lime-400 hover:text-lime-300"
                  >
                    {s.site_url} <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  {s.description && <p className="text-sm text-white/60">{s.description}</p>}
                  <p className="text-xs text-white/40">联系方式：{s.contact}</p>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    disabled={busyId === s.id}
                    onClick={() => actSubmission(s.id, "approve")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-lime-400/40 bg-lime-400/15 px-3 py-1.5 text-sm font-medium text-lime-300 transition hover:bg-lime-400/25 disabled:opacity-50"
                  >
                    {busyId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    通过并上墙
                  </button>
                  <button
                    disabled={busyId === s.id}
                    onClick={() => actSubmission(s.id, "reject")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/60 transition hover:text-white disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" /> 拒绝
                  </button>
                  <button
                    disabled={busyId === s.id}
                    onClick={() => actSubmission(s.id, "spam")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/50 transition hover:text-red-400 disabled:opacity-50"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" /> 垃圾
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* —— 新增友链 —— */}
      <section className="admin-panel-glass admin-tab-enter space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-lime-400" />
          <h2 className="text-lg font-bold">手动添加友链</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={inputCls} placeholder="站名 *" maxLength={60} value={addDraft.name} onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))} />
          <select
            className={cn(inputCls, "appearance-none")}
            value={addDraft.category}
            onChange={(e) => setAddDraft((d) => ({ ...d, category: e.target.value as Category }))}
          >
            <option value="friend">朋友的小站</option>
            <option value="nav">二次元 · ACG 导航</option>
          </select>
        </div>
        <input className={inputCls} placeholder="网址 https://… *" maxLength={300} value={addDraft.url} onChange={(e) => setAddDraft((d) => ({ ...d, url: e.target.value }))} />
        <input className={inputCls} placeholder="简介（选填）" maxLength={200} value={addDraft.description} onChange={(e) => setAddDraft((d) => ({ ...d, description: e.target.value }))} />
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={inputCls} placeholder="icon 链接（选填）" maxLength={300} value={addDraft.icon_url} onChange={(e) => setAddDraft((d) => ({ ...d, icon_url: e.target.value }))} />
          <input className={inputCls} placeholder="小标签（选填，如「技术博客」）" maxLength={30} value={addDraft.tag} onChange={(e) => setAddDraft((d) => ({ ...d, tag: e.target.value }))} />
        </div>
        <button
          disabled={adding}
          onClick={addLink}
          className="inline-flex items-center gap-2 rounded-xl border border-lime-400/40 bg-lime-400/15 px-4 py-2 text-sm font-medium text-lime-300 transition hover:bg-lime-400/25 disabled:opacity-50"
        >
          {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          添加
        </button>
      </section>

      {/* —— 现有友链（分区） —— */}
      {(["friend", "nav"] as const).map((cat) => {
        const items = links.filter((l) => l.category === cat).sort((a, b) => a.sort_order - b.sort_order)
        return (
          <section key={cat} className="admin-panel-glass admin-tab-enter space-y-3 p-5">
            <div className="flex items-baseline gap-2">
              <h2 className="text-lg font-bold">{CAT_LABEL[cat]}</h2>
              <span className="text-xs text-white/30">{loading ? "…" : `${items.length} 条`}</span>
            </div>
            {loading ? (
              <SkeletonRows rows={2} />
            ) : items.length === 0 ? (
              <p className="text-sm text-white/40">（空）</p>
            ) : (
              <div className="space-y-2">
                {items.map((link, i) =>
                  editingId === link.id ? (
                    <div key={link.id} className="space-y-2 rounded-xl border border-lime-400/30 bg-black/40 p-4">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input className={inputCls} placeholder="站名" value={editDraft.name} onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))} />
                        <select className={cn(inputCls, "appearance-none")} value={editDraft.category} onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value as Category }))}>
                          <option value="friend">朋友的小站</option>
                          <option value="nav">二次元 · ACG 导航</option>
                        </select>
                      </div>
                      <input className={inputCls} placeholder="网址" value={editDraft.url} onChange={(e) => setEditDraft((d) => ({ ...d, url: e.target.value }))} />
                      <input className={inputCls} placeholder="简介" value={editDraft.description} onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))} />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input className={inputCls} placeholder="icon 链接" value={editDraft.icon_url} onChange={(e) => setEditDraft((d) => ({ ...d, icon_url: e.target.value }))} />
                        <input className={inputCls} placeholder="小标签" value={editDraft.tag} onChange={(e) => setEditDraft((d) => ({ ...d, tag: e.target.value }))} />
                      </div>
                      <div className="flex items-center gap-2">
                        <button disabled={busyId === link.id} onClick={saveEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-lime-400/40 bg-lime-400/15 px-3 py-1.5 text-sm text-lime-300 hover:bg-lime-400/25 disabled:opacity-50">
                          {busyId === link.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} 保存
                        </button>
                        <button onClick={() => setEditingId(null)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white/60 hover:text-white">取消</button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={link.id}
                      className={cn(
                        "admin-inset-glass flex items-center gap-3 p-3",
                        !link.is_visible && "opacity-50",
                      )}
                    >
                      <div className="flex flex-col">
                        <button disabled={i === 0 || busyId === link.id} onClick={() => move(link, -1)} className="text-white/40 hover:text-lime-300 disabled:opacity-20" aria-label="上移">
                          <ChevronUp className="h-4 w-4" />
                        </button>
                        <button disabled={i === items.length - 1 || busyId === link.id} onClick={() => move(link, 1)} className="text-white/40 hover:text-lime-300 disabled:opacity-20" aria-label="下移">
                          <ChevronDown className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold text-white/90">{link.name}</span>
                          {link.tag && <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40">{link.tag}</span>}
                          {!link.is_visible && <span className="shrink-0 text-[10px] text-amber-400/70">已隐藏</span>}
                        </div>
                        <p className="truncate text-xs text-white/40">{link.url}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button disabled={busyId === link.id} onClick={() => toggleVisible(link)} className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-lime-300 disabled:opacity-40" aria-label="显示/隐藏">
                          {link.is_visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                        <button disabled={busyId === link.id} onClick={() => startEdit(link)} className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-lime-300 disabled:opacity-40" aria-label="编辑">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button disabled={busyId === link.id} onClick={() => deleteLink(link)} className="rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-red-400 disabled:opacity-40" aria-label="删除">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
