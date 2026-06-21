"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { X, Trash2, Plus, Music2, Play, Square, Loader2, Download, Upload } from "lucide-react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import {
  getUserMusicTracks,
  addUserMusicTrack,
  addUserMusicTracks,
  deleteUserMusicTrack,
  clearUserMusicTracks,
  type UserMusicTrackRow,
} from "@/lib/supabase"
import { usePlayback } from "../_context/PlaybackContext"
import { parseMusicUrl, fetchMetingTracks, platformLabel } from "../_lib/musicImport"
import {
  listLocalTracks,
  addLocalTrack,
  deleteLocalTrack,
  clearLocalTracks,
  fileToLocalRecord,
  estimateStorage,
  MAX_LOCAL_TRACKS,
  MAX_LOCAL_FILE_BYTES,
  type LocalTrackRecord,
} from "../_lib/localTracks"

const MAX_TRACKS = 100
// 导入冷却：两次歌单解析至少间隔这么久，降低对 injahow 的抓取频率。
// 软限制（前端记账 + localStorage 持久化，刷新不重置）；够挡住正常误操作 / 连点。
const IMPORT_COOLDOWN_MS = 60_000
const IMPORT_COOLDOWN_KEY = "music-import-cooldown"
const isHttps = (s: string) => /^https:\/\//i.test(s.trim())

// 钉死输入框配色：绕过移动端 WebView 原生 input 白底、不依赖 Tailwind JIT。
const FIELD_STYLE: CSSProperties = {
  appearance: "none",
  WebkitAppearance: "none",
  background: "rgba(0,0,0,0.35)",
  color: "#ffffff",
  caretColor: "#ffffff",
}
const FIELD_CLASS =
  "w-full rounded-lg px-3 py-2 text-[13px] outline-none ring-1 ring-white/15 placeholder:text-white/45 focus:ring-white/35"

// 圆润胶囊按钮：次要（磨砂玻璃）/ 主要（白底）。
const BTN_SECONDARY =
  "flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-[12px] font-medium text-white/85 ring-1 ring-white/15 transition-all hover:bg-white/20 hover:text-white active:scale-95 disabled:opacity-50"
const BTN_PRIMARY =
  "flex items-center gap-1.5 rounded-full bg-white px-5 py-2 text-[12px] font-semibold text-black shadow-[0_8px_24px_-8px_rgba(255,255,255,0.45)] transition-all hover:scale-[1.04] active:scale-95 disabled:opacity-50"

type PreviewState = "idle" | "loading" | "ok" | "fail"

/**
 * 「我的音乐」编辑器。只存外链：用户填 标题/歌手/封面URL/音频URL，
 * 我们只把链接写进 user_music_tracks，播放由听众浏览器直连（不托管字节）。
 * 「试听」按钮当场用临时 <audio> 验证链接能否播，降低"贴了不响"的困惑。
 */
export function MusicLibraryEditor({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { user } = useSimpleAuth()
  const { toast } = useToast()
  const { refreshTracks } = usePlayback()

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const [rows, setRows] = useState<UserMusicTrackRow[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // 本地上传曲目（IndexedDB，仅本设备 / 本浏览器；游客也可用）。
  const [localRows, setLocalRows] = useState<LocalTrackRecord[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const totalCount = rows.length + localRows.length

  // 表单
  const [title, setTitle] = useState("")
  const [artist, setArtist] = useState("")
  const [coverUrl, setCoverUrl] = useState("")
  const [audioUrl, setAudioUrl] = useState("")

  // 网易导入
  const [importUrl, setImportUrl] = useState("")
  const [importing, setImporting] = useState(false)
  // 本次导入数量（1..剩余配额）；歌单可能几百首，用户用滑块自选导前 N 首。
  const [importCount, setImportCount] = useState(MAX_TRACKS)
  // 导入冷却记账（lastImportAt 持久化；nowTs 每秒 tick 用于倒计时显示）
  const lastImportAtRef = useRef(0)
  const [nowTs, setNowTs] = useState(() => Date.now())
  useEffect(() => {
    try {
      lastImportAtRef.current = Number(localStorage.getItem(IMPORT_COOLDOWN_KEY)) || 0
    } catch {
      /* ignore */
    }
  }, [])
  // 仅在面板打开时每秒刷新一次，驱动倒计时
  useEffect(() => {
    if (!open) return
    setNowTs(Date.now())
    const id = window.setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open])
  const importCooldownLeft = Math.max(0, IMPORT_COOLDOWN_MS - (nowTs - lastImportAtRef.current))
  const importCooldownSec = Math.ceil(importCooldownLeft / 1000)

  // 本次最多可导入数 = 剩余配额（≥1，供滑块上限用）；rows 变动后把 importCount 收敛进区间
  const importMax = Math.max(1, MAX_TRACKS - rows.length)
  useEffect(() => {
    setImportCount((c) => Math.min(Math.max(1, c), Math.max(1, MAX_TRACKS - rows.length)))
  }, [rows.length])

  // 试听
  const [previewState, setPreviewState] = useState<PreviewState>("idle")
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)
  const stopPreview = useCallback(() => {
    previewAudioRef.current?.pause()
    previewAudioRef.current = null
    setPreviewState("idle")
  }, [])

  // 打开时拉取本人曲目；关闭时停掉试听
  useEffect(() => {
    if (!open) {
      stopPreview()
      return
    }
    if (!user?.id) return
    let cancelled = false
    setLoading(true)
    getUserMusicTracks(user.id)
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, user?.id, stopPreview])

  // 打开时载入本地上传曲目（IndexedDB，与登录无关）。
  useEffect(() => {
    if (!open) return
    let cancelled = false
    listLocalTracks()
      .then((r) => {
        if (!cancelled) setLocalRows(r)
      })
      .catch(() => {
        if (!cancelled) setLocalRows([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // 卸载兜底：别让试听音频在后台继续响
  useEffect(() => () => stopPreview(), [stopPreview])

  const handlePreview = useCallback(() => {
    const url = audioUrl.trim()
    if (!isHttps(url)) {
      toast({ description: "音频链接需以 https:// 开头" })
      return
    }
    // 正在试听 → 停止
    const cur = previewAudioRef.current
    if (cur && !cur.paused) {
      stopPreview()
      return
    }
    stopPreview()
    const a = new Audio(url)
    previewAudioRef.current = a
    a.onerror = () => setPreviewState("fail")
    a.onended = () => setPreviewState("idle")
    setPreviewState("loading")
    a.play()
      .then(() => setPreviewState("ok"))
      .catch(() => setPreviewState("fail"))
  }, [audioUrl, stopPreview, toast])

  const handleAdd = useCallback(async () => {
    if (!user?.id) return
    const t = title.trim()
    const au = audioUrl.trim()
    const cv = coverUrl.trim()
    if (!t) return toast({ description: "请填写标题" })
    if (!isHttps(au)) return toast({ description: "音频链接需以 https:// 开头" })
    if (cv && !isHttps(cv)) return toast({ description: "封面链接需以 https:// 开头" })
    if (rows.length >= MAX_TRACKS) return toast({ description: `最多 ${MAX_TRACKS} 首` })

    setSaving(true)
    try {
      const row = await addUserMusicTrack(
        user.id,
        { title: t, artist: artist.trim(), cover_url: cv, audio_url: au, source: "link" },
        rows.length,
      )
      setRows((prev) => [...prev, row])
      setTitle("")
      setArtist("")
      setCoverUrl("")
      setAudioUrl("")
      stopPreview()
      await refreshTracks()
      toast({ description: "已添加" })
    } catch (e) {
      toast({ description: (e as Error)?.message ?? "添加失败" })
    } finally {
      setSaving(false)
    }
  }, [user?.id, title, artist, coverUrl, audioUrl, rows.length, refreshTracks, stopPreview, toast])

  const handleImport = useCallback(async () => {
    if (!user?.id || importing) return
    // 冷却：两次导入至少隔 IMPORT_COOLDOWN_MS，降低对 injahow 的抓取频率。
    const left = IMPORT_COOLDOWN_MS - (Date.now() - lastImportAtRef.current)
    if (left > 0) {
      return toast({ description: `导入太频繁，请 ${Math.ceil(left / 1000)}s 后再试` })
    }
    const parsed = parseMusicUrl(importUrl)
    if (!parsed) {
      return toast({
        description: "请粘贴网易云(music.163.com)或 QQ音乐(y.qq.com)的完整歌单 / 单曲链接",
      })
    }
    const remaining = MAX_TRACKS - rows.length
    if (remaining <= 0) return toast({ description: `已满 ${MAX_TRACKS} 首` })

    setImporting(true)
    // 记账：开始抓取即计冷却（失败也算，避免 injahow 故障时被连点重试狂打）。
    lastImportAtRef.current = Date.now()
    try {
      localStorage.setItem(IMPORT_COOLDOWN_KEY, String(lastImportAtRef.current))
    } catch {
      /* ignore */
    }
    setNowTs(Date.now())
    try {
      const items = await fetchMetingTracks(parsed.platform, parsed.ref)
      const slice = items.slice(0, Math.min(importCount, remaining))
      const inserted = await addUserMusicTracks(user.id, slice, rows.length)
      setRows((prev) => [...prev, ...inserted])
      setImportUrl("")
      await refreshTracks()
      const leftover = items.length - inserted.length
      toast({
        description: `从${platformLabel(parsed.platform)}导入 ${inserted.length} 首${
          leftover > 0 ? `（歌单还有 ${leftover} 首未导）` : ""
        }`,
      })
    } catch (e) {
      toast({ description: (e as Error)?.message ?? "导入失败" })
    } finally {
      setImporting(false)
    }
  }, [user?.id, importing, importUrl, importCount, rows.length, refreshTracks, toast])

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteUserMusicTrack(id)
        setRows((prev) => prev.filter((r) => r.id !== id))
        await refreshTracks()
      } catch (e) {
        toast({ description: (e as Error)?.message ?? "删除失败" })
      }
    },
    [refreshTracks, toast],
  )

  const handleClear = useCallback(async () => {
    if (totalCount === 0) return
    if (
      !window.confirm(
        `确定清空全部 ${totalCount} 首（含本地上传）？删光后墙会回到精选默认墙，此操作不可撤销。`,
      )
    )
      return
    try {
      if (user?.id && rows.length > 0) await clearUserMusicTracks(user.id)
      if (localRows.length > 0) await clearLocalTracks()
      setRows([])
      setLocalRows([])
      await refreshTracks()
      toast({ description: "已清空" })
    } catch (e) {
      toast({ description: (e as Error)?.message ?? "清空失败" })
    }
  }, [user?.id, rows.length, localRows.length, totalCount, refreshTracks, toast])

  // 上传本地音频：逐个解析标签/封面 → 存 IndexedDB。游客也可用（不依赖登录）。
  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0 || uploading) return
      const remaining = MAX_LOCAL_TRACKS - localRows.length
      if (remaining <= 0) {
        toast({ description: `本地歌最多 ${MAX_LOCAL_TRACKS} 首` })
        return
      }
      const slice = Array.from(files).slice(0, remaining)
      setUploading(true)
      let added = 0
      let startIndex = localRows.length
      try {
        for (const file of slice) {
          if (file.size > MAX_LOCAL_FILE_BYTES) {
            toast({
              description: `「${file.name}」超过 ${Math.round(MAX_LOCAL_FILE_BYTES / 1048576)}MB，已跳过`,
            })
            continue
          }
          // 配额预检：估算用量 + 本文件超过 95% 配额则停手。
          const est = await estimateStorage()
          if (est && est.quota > 0 && est.usage + file.size > est.quota * 0.95) {
            toast({ description: "浏览器存储空间不足，已停止上传" })
            break
          }
          try {
            await addLocalTrack(await fileToLocalRecord(file, startIndex))
            startIndex++
            added++
          } catch (e) {
            toast({
              description:
                (e as Error)?.name === "QuotaExceededError"
                  ? "浏览器存储空间已满"
                  : `「${file.name}」保存失败`,
            })
            break
          }
        }
        if (added > 0) {
          setLocalRows(await listLocalTracks())
          await refreshTracks()
          // best-effort 申请持久化存储，降低被浏览器回收的概率。
          try {
            await navigator.storage?.persist?.()
          } catch {
            /* ignore */
          }
          toast({ description: `已添加 ${added} 首本地歌曲` })
        }
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = "" // 允许重选同名文件
      }
    },
    [uploading, localRows.length, refreshTracks, toast],
  )

  const handleDeleteLocal = useCallback(
    async (id: string) => {
      try {
        await deleteLocalTrack(id)
        setLocalRows((prev) => prev.filter((r) => r.id !== id))
        await refreshTracks()
      } catch (e) {
        toast({ description: (e as Error)?.message ?? "删除失败" })
      }
    },
    [refreshTracks, toast],
  )

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="absolute inset-0 bg-black/55" />

          <motion.div
            onClick={(e) => e.stopPropagation()}
            className="relative z-[71] flex max-h-[85vh] w-[min(520px,100%)] flex-col overflow-hidden rounded-3xl text-white"
            style={{
              // 深色调磨砂毛玻璃：半透 + 强 blur + saturate —— 透出背景氤氲、又够暗保证白字可读。
              background: "rgba(18,18,24,0.64)",
              backdropFilter: "blur(40px) saturate(170%)",
              WebkitBackdropFilter: "blur(40px) saturate(170%)",
              boxShadow:
                "0 30px 90px -15px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.12)",
            }}
            initial={{ opacity: 0, scale: 0.96, filter: "blur(20px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.96, filter: "blur(20px)" }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {/* 顶部高光，增加玻璃质感（在内容之下，纯装饰） */}
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-28"
              style={{
                background:
                  "linear-gradient(to bottom, rgba(255,255,255,0.10), transparent)",
              }}
            />

            {/* Header */}
            <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-3">
              <div className="flex items-center gap-2">
                <Music2 size={16} className="text-white/70" />
                <h2 className="text-[14px] font-semibold tracking-wide">我的音乐</h2>
                <span className="text-[11px] text-white/40">{totalCount} 首</span>
              </div>
              <button
                type="button"
                aria-label="close"
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
              >
                <X size={15} />
              </button>
            </div>

            {/* 上传本地歌曲（存于本设备浏览器，不上传服务器；游客也可用） */}
            <div className="shrink-0 px-5 pt-1 pb-3">
              <div className="mb-1.5 text-[11px] tracking-wide text-white/45">
                上传本地歌曲（存于本设备浏览器，不上传服务器）
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  void handleFiles(e.dataTransfer.files)
                }}
                disabled={uploading}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/25 bg-white/[0.04] px-4 py-3 text-[12px] font-medium text-white/80 transition-all hover:border-white/40 hover:bg-white/[0.08] hover:text-white active:scale-[0.99] disabled:opacity-50"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploading ? "解析中…" : "选择 / 拖入音频文件"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={(e) => void handleFiles(e.target.files)}
              />
              <div className="mt-2 text-[10px] leading-snug text-white/30">
                支持 mp3 / flac / m4a 等；自动读取标题 / 歌手 / 封面。单文件 ≤
                {Math.round(MAX_LOCAL_FILE_BYTES / 1048576)}MB、最多 {MAX_LOCAL_TRACKS} 首。
                本地歌支持真实音频可视化（背景与频谱跟拍）。
              </div>
            </div>

            <div className="mx-5 shrink-0 border-t border-white/10" />

            {/* 网易歌单 / 单曲导入 */}
            <div className="shrink-0 px-5 pt-1 pb-3">
              <div className="mb-1.5 text-[11px] tracking-wide text-white/45">
                从 网易云 / QQ音乐 歌单 / 单曲导入
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={importUrl}
                  onChange={(e) => setImportUrl(e.target.value)}
                  placeholder="粘贴 music.163.com 或 y.qq.com 链接"
                  style={FIELD_STYLE}
                  className="min-w-0 flex-1 rounded-lg px-3 py-2 text-[13px] outline-none ring-1 ring-white/15 placeholder:text-white/45 focus:ring-white/35"
                />
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importing || importCooldownLeft > 0}
                  className={`${BTN_SECONDARY} shrink-0`}
                >
                  {importing ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Download size={13} />
                  )}
                  {importCooldownLeft > 0 ? `${importCooldownSec}s` : "导入"}
                </button>
              </div>

              <ImportCountSlider value={importCount} max={importMax} onChange={setImportCount} />

              <div className="mt-2 text-[10px] leading-snug text-white/30">
                最多 {MAX_TRACKS} 首；滑块选本次导入数量。经第三方公共解析，QQ音乐源不如网易稳定，部分 VIP / 区域受限歌曲可能无法播放。
              </div>
            </div>

            <div className="mx-5 shrink-0 border-t border-white/10" />

            {/* 手动添加（直链） */}
            <div className="shrink-0 space-y-2 px-5 pb-4 pt-3">
              <div className="text-[11px] tracking-wide text-white/45">手动添加（直链）</div>
              <Field value={title} onChange={setTitle} placeholder="标题（必填）" />
              <Field value={artist} onChange={setArtist} placeholder="歌手（可选）" />
              <Field value={coverUrl} onChange={setCoverUrl} placeholder="封面图片直链 https://…（可选）" />
              <Field value={audioUrl} onChange={setAudioUrl} placeholder="音频直链 https://…（必填）" />

              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={handlePreview} className={BTN_SECONDARY}>
                  {previewState === "loading" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : previewAudioRef.current && !previewAudioRef.current.paused ? (
                    <Square size={13} />
                  ) : (
                    <Play size={13} />
                  )}
                  试听
                </button>
                <PreviewHint state={previewState} />

                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={saving}
                  className={`${BTN_PRIMARY} ml-auto`}
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  添加
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="mx-5 shrink-0 border-t border-white/10" />

            {/* 列表头：已添加数量 + 清空（移到歌曲区这边） */}
            {totalCount > 0 && (
              <div className="flex shrink-0 items-center justify-between px-5 pt-3 pb-1">
                <span className="text-[11px] tracking-wide text-white/45">
                  已添加 {totalCount} 首
                </span>
                <button
                  type="button"
                  onClick={handleClear}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-white/45 transition-colors hover:bg-white/10 hover:text-rose-300"
                >
                  <Trash2 size={11} />
                  清空
                </button>
              </div>
            )}

            {/* List */}
            <div className="custom-scroll min-h-[80px] flex-1 overflow-y-auto px-3 py-2">
              {loading ? (
                <div className="grid place-items-center py-8 text-white/40">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              ) : totalCount === 0 ? (
                <div className="px-3 py-8 text-center text-[12px] text-white/35">
                  还没有曲目。上传本地歌曲，或填链接 / 导入歌单。
                </div>
              ) : (
                <div className="space-y-0.5">
                  {/* 本地上传歌（在前，与「我的」墙顺序一致） */}
                  {localRows.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-white/90">{r.title}</div>
                        <div className="truncate text-[10px] text-white/45">
                          {r.artist || "—"} · 本地
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="delete"
                        onClick={() => handleDeleteLocal(r.id)}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/40 hover:bg-white/10 hover:text-rose-300"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  {/* 链接 / 导入歌（存 Supabase） */}
                  {rows.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-white/90">{r.title}</div>
                        <div className="truncate text-[10px] text-white/45">
                          {r.artist || "—"}
                          {r.source === "netease" ? " · 网易导入" : r.source === "tencent" ? " · QQ音乐导入" : ""}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label="delete"
                        onClick={() => handleDelete(r.id)}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/40 hover:bg-white/10 hover:text-rose-300"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Field({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={FIELD_STYLE}
      className={FIELD_CLASS}
    />
  )
}

function PreviewHint({ state }: { state: PreviewState }) {
  if (state === "ok") return <span className="text-[11px] text-emerald-300">可播放 ✓</span>
  if (state === "fail")
    return <span className="text-[11px] text-rose-300">无法播放（跨域/防盗链/链接失效）</span>
  if (state === "loading") return <span className="text-[11px] text-white/40">加载中…</span>
  return null
}

/**
 * 导入数量滑块（1..max）。视觉自定义 + 透明原生 range 叠加：外观完全可控、
 * 契合毛玻璃风，又复用原生 range 的拖动 / 点击定位 / 键盘无障碍，避开各
 * WebView 原生 range 样式差异。
 */
function ImportCountSlider({
  value,
  max,
  onChange,
}: {
  value: number
  max: number
  onChange: (v: number) => void
}) {
  const pct = max <= 1 ? 0 : ((value - 1) / (max - 1)) * 100
  return (
    <div className="mt-2.5 flex items-center gap-3">
      <span className="shrink-0 text-[11px] tracking-wide text-white/45">导入数量</span>
      <div className="relative h-5 flex-1">
        {/* 轨道 + 已选填充 */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/15">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/80"
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* thumb */}
        <div
          className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.4)]"
          style={{ left: `${pct}%` }}
        />
        {/* 交互层：透明原生 range 盖满，负责拖动 / 无障碍 */}
        <input
          type="range"
          min={1}
          max={max}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0"
          aria-label="导入数量"
        />
      </div>
      <span className="w-12 shrink-0 text-right text-[12px] font-semibold tabular-nums text-white">
        {value} 首
      </span>
    </div>
  )
}
