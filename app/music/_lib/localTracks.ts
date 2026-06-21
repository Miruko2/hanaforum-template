import type { Track } from "../_data/tracks"

// ============================================================
// 本地歌曲存储层（IndexedDB）
// ------------------------------------------------------------
// 用户从本机上传的音频「字节」存在浏览器 IndexedDB 里（不上传服务器、零 egress），
// 仅本设备 / 本浏览器可见，清缓存即丢。与「我的」链接歌（存 Supabase、跨设备同步）
// 并存，各自独立。
//
// 为什么是 IndexedDB 而非 localStorage：localStorage 只能存字符串、上限 ~5MB，
// 装不下音频字节；IndexedDB 能直接存 Blob、配额是磁盘的一个比例（通常上百 MB~GB）。
//
// 关键收益：本地文件经 URL.createObjectURL 播放 = 同源 blob，可接 Web Audio
// AnalyserNode 拿到真实频谱（跨域的网易源做不到，见 PlaybackContext 注释）。
// ============================================================

const DB_NAME = "music-local"
const DB_VERSION = 1
const STORE = "tracks"

export type LocalTrackRecord = {
  id: string // "local-" + uuid
  title: string
  artist: string
  blob: Blob // 音频字节（只能 Blob，不能 data URL）
  mime: string
  size: number // 字节数
  duration: number // 秒，未探测时为 0（播放时由 <audio> 自然读出）
  cover: string // 缩小后的封面 data URL；空串 = 无封面
  sortIndex: number
  addedAt: number
}

// ---- 单文件 / 总量上限：防一次塞爆配额（安卓 WebView 配额更紧）----
export const MAX_LOCAL_TRACKS = 50
export const MAX_LOCAL_FILE_BYTES = 30 * 1024 * 1024 // 30MB/首

const hasIDB = () => typeof indexedDB !== "undefined"

// memoize：同一页面生命周期复用一个连接 promise
let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (!hasIDB()) return Promise.reject(new Error("IndexedDB 不可用"))
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("打开本地音乐库失败"))
  })
  // 打开失败时清掉 memo，下次重试
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 操作失败"))
  })
}

function genId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return `local-${crypto.randomUUID()}`
  } catch {
    /* ignore */
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// ---- CRUD ----------------------------------------------------

export async function listLocalTracks(): Promise<LocalTrackRecord[]> {
  if (!hasIDB()) return []
  try {
    const db = await openDB()
    const tx = db.transaction(STORE, "readonly")
    const rows = await promisify(tx.objectStore(STORE).getAll() as IDBRequest<LocalTrackRecord[]>)
    return (rows ?? []).sort((a, b) => a.sortIndex - b.sortIndex || a.addedAt - b.addedAt)
  } catch {
    return []
  }
}

export async function addLocalTrack(record: LocalTrackRecord): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE, "readwrite")
  tx.objectStore(STORE).put(record)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("写入本地音乐失败"))
    tx.onabort = () => reject(tx.error ?? new Error("写入本地音乐被中止（配额不足？）"))
  })
}

export async function deleteLocalTrack(id: string): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE, "readwrite")
  tx.objectStore(STORE).delete(id)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("删除本地音乐失败"))
  })
}

export async function clearLocalTracks(): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(STORE, "readwrite")
  tx.objectStore(STORE).clear()
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("清空本地音乐失败"))
  })
}

/** 播放时按 id 取音频字节。找不到返回 null（记录已被删 / 库被清）。 */
export async function getLocalTrackBlob(id: string): Promise<Blob | null> {
  if (!hasIDB()) return null
  try {
    const db = await openDB()
    const tx = db.transaction(STORE, "readonly")
    const rec = await promisify(tx.objectStore(STORE).get(id) as IDBRequest<LocalTrackRecord | undefined>)
    return rec?.blob ?? null
  } catch {
    return null
  }
}

/** 存储配额估算（字节）。不支持的环境返回 null。 */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate()
      return { usage, quota }
    }
  } catch {
    /* ignore */
  }
  return null
}

// ---- 记录 → 3D 墙用的 Track --------------------------------
// hue/ratio/span 由 id 哈希确定性生成（与 userTracks.ts 同套，布局稳定、跨刷新一致）。

function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function localRecordToTrack(rec: LocalTrackRecord): Track {
  const h = hash32(rec.id)
  const hue = h % 360
  const ratio = 0.85 + ((h >>> 8) % 51) / 100
  const span: 1 | 2 = (h >>> 16) % 7 === 0 ? 2 : 1
  return {
    id: rec.id,
    title: rec.title || "未命名",
    artist: rec.artist || "",
    cover: rec.cover || "", // data URL 或空
    audio: "", // 本地歌不走 URL：播放时按 id 从 IndexedDB 取 Blob（见 PlaybackContext）
    hue,
    ratio,
    span,
    userProvided: true, // 复用「原生 img + 跳过取色」渲染路径
    local: true,
  }
}

export function localRecordsToTracks(recs: LocalTrackRecord[]): Track[] {
  return recs.map(localRecordToTrack)
}

// ============================================================
// 文件 → 记录 解析管线（jsmediatags 读标签 + 内嵌封面）
// ------------------------------------------------------------
// 仅客户端动态导入浏览器 dist，不进其它页 bundle。解析失败回退文件名 / 无封面。
// ============================================================

// 只声明本模块用到的最小标签形状，避免依赖 dist 子路径的类型解析。
type JsmediaPicture = { format?: string; data?: number[] }
type JsmediaTags = { title?: string; artist?: string; picture?: JsmediaPicture }

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || name
}

function readTags(file: File): Promise<JsmediaTags | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (v: JsmediaTags | null) => {
      if (!settled) {
        settled = true
        resolve(v)
      }
    }
    // 解析卡死兜底：4s 超时即回退
    const timer = setTimeout(() => done(null), 4000)
    import("jsmediatags/dist/jsmediatags.min.js")
      .then((mod) => {
        const jsmediatags = (mod as { default?: unknown }).default ?? mod
        ;(jsmediatags as { read: (f: File, cb: unknown) => void }).read(file, {
          onSuccess: (data: { tags?: JsmediaTags }) => {
            clearTimeout(timer)
            done(data?.tags ?? null)
          },
          onError: () => {
            clearTimeout(timer)
            done(null)
          },
        })
      })
      .catch(() => {
        clearTimeout(timer)
        done(null)
      })
  })
}

/** 内嵌封面字节 → 缩到 ≤maxDim 的 jpeg data URL（省掉 objectURL 生命周期）。失败返回 ""。 */
async function pictureToCoverDataUrl(pic: JsmediaPicture, maxDim = 256): Promise<string> {
  if (!pic?.data || pic.data.length === 0) return ""
  const bytes = new Uint8Array(pic.data)
  const blob = new Blob([bytes], { type: pic.format || "image/jpeg" })
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error("封面解码失败"))
      im.src = url
    })
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight || 1))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || img.naturalWidth) * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return ""
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL("image/jpeg", 0.82)
  } catch {
    return ""
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 把用户选的音频文件解析成可入库的记录。
 * title/artist/封面尽力解析，失败回退：title=文件名、artist=空、无封面。
 * 不在此探测 duration（上传更快；播放时 <audio> 自然读出）。
 */
export async function fileToLocalRecord(file: File, sortIndex: number): Promise<LocalTrackRecord> {
  const tags = await readTags(file)
  const title = (tags?.title || "").trim() || stripExt(file.name)
  const artist = (tags?.artist || "").trim()
  const cover = tags?.picture ? await pictureToCoverDataUrl(tags.picture) : ""
  return {
    id: genId(),
    title,
    artist,
    blob: file,
    mime: file.type || "audio/*",
    size: file.size,
    duration: 0,
    cover,
    sortIndex,
    addedAt: Date.now(),
  }
}
