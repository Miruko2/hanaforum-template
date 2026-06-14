"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { usePathname } from "next/navigation"
import { DEFAULT_TRACKS, type Track } from "../_data/tracks"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import { getUserMusicTracks, type UserMusicTrackRow } from "@/lib/supabase"
import { userRowsToTracks } from "../_lib/userTracks"
import { metingAlternatives, pickHealthyMetingBase, rewriteMetingBase, METING_INSTANCES } from "../_lib/metingInstances"

const HISTORY_KEY = "music-history-v1"
const HISTORY_LIMIT = 50
const FAVORITES_KEY = "music-favorites-v1"
const PLAY_MODE_KEY = "music-play-mode-v1"
const SOURCE_KEY = "music-source-v1"
const VOLUME_KEY = "music-volume-v1"
const LYRICS_KEY = "music-lyrics-v1"
const LIQUID_FX_KEY = "music-liquidfx-v1"
const HEALTHY_BASE_KEY = "music-meting-base-v2" // 上次探测出的健康 meting 实例：{ base, at }
// 缓存只在足够「新鲜」时才同步采信：实例健康状态偶尔翻转，几小时内的缓存基本仍准
//（帮首曲在探测返回前就用对实例）；但跨天的旧缓存可能指向已死实例，那还不如退回构建
// 默认（列表首位＝当前最可靠实例），免得反把首曲拖到坏实例上（iOS 上即首曲放不出）。
const HEALTHY_BASE_TTL = 6 * 60 * 60_000 // 6h

// 墙的曲目源：「我的」自定义 vs「精选」默认墙。
export type MusicSource = "mine" | "featured"

// 播放模式：列表循环 / 单曲循环 / 播完就暂停。
export type PlayMode = "list" | "one" | "once"

/** 详情页桌面液面背景的自动律动模式（off = 默认，只留鼠标交互）。 */
export type LiquidFx = "rain" | "center" | "off"

// ---- 音频拉取冷却 / 复用（防 ban、防滥用）----
// REUSE_TTL：同一首在此窗口内已拉取过 → 复用，不重置 src、不再打外部源。
// MIN_GAP：两次"解析新音频"的最小间隔；更快的连点会被防抖合并成只解析最后一首。
// MAX_RESOLVES_PER_MIN：每分钟解析上限，硬安全网，超了直接拒绝并提示。
const REUSE_TTL = 5 * 60_000
const MIN_GAP = 1500
const MAX_RESOLVES_PER_MIN = 20

export type HistoryEntry = {
  trackId: string
  playedAt: number
}

export type PlaybackState = {
  currentTrack: Track | null
  isPlaying: boolean
  isFallback: boolean      // true when the current track's audio source is unavailable
  /** 播放模式：列表循环 / 单曲循环 / 播完就暂停。持久化。 */
  playMode: PlayMode
  history: HistoryEntry[]
  /** Favorite track ids, newest first. Persisted to localStorage. */
  favorites: string[]
  tracks: Track[]
  // actions
  play: (id: string) => void
  pause: () => void
  togglePlay: (id?: string) => void
  seek: (timeSeconds: number) => void
  next: () => void
  prev: () => void
  clearHistory: () => void
  isFavorite: (id: string) => boolean
  toggleFavorite: (id: string) => void
  /** 设置播放模式（列表循环 / 单曲循环 / 播完就暂停）。 */
  setPlayMode: (m: PlayMode) => void
  /** 播放音量 [0,1]，持久化到 localStorage。 */
  volume: number
  /** 设置音量 [0,1]（自动夹取范围并持久化）。 */
  setVolume: (v: number) => void
  /** 详情页歌词显示开关，持久化到 localStorage。 */
  lyricsEnabled: boolean
  setLyricsEnabled: (on: boolean) => void
  /** 详情页桌面液面背景的自动律动模式，持久化到 localStorage。 */
  liquidFx: LiquidFx
  setLiquidFx: (m: LiquidFx) => void
  /**
   * Returns the current audio intensity in [0, 1], smoothed across frames.
   * Implementation strategy:
   *   1. Try Web Audio API + AnalyserNode → real FFT bass energy
   *   2. If the audio source is cross-origin without CORS, the analyser
   *      returns silence; we detect that and switch to a simulated sine pulse
   *   3. When paused / no track, returns 1 (steady "normal" state, no pulse)
   * Callers should poll this each frame via rAF — it's a pure read, doesn't
   * trigger React re-renders.
   */
  getAudioIntensity: () => number
  /** 重新拉取当前用户的自定义曲目并刷新墙（编辑器增删改后调用）。 */
  refreshTracks: () => Promise<void>
}

const PlaybackCtx = createContext<PlaybackState | null>(null)

export function usePlayback(): PlaybackState {
  const ctx = useContext(PlaybackCtx)
  if (!ctx) throw new Error("usePlayback must be used inside <PlaybackProvider>")
  return ctx
}

// ---- 高频时间 Context：currentTime / duration / buffered ----
// 只有进度条组件（MusicPlayer / ExpandedCard）需要订阅这些每 240ms 变化一次的值。
// 拆成独立 Context 后，卡片墙、HistoryPanel 等不会被时间抖动触发重渲染。
export type PlaybackTimeState = {
  currentTime: number
  duration: number
  buffered: number
}
const PlaybackTimeCtx = createContext<PlaybackTimeState>({
  currentTime: 0,
  duration: 0,
  buffered: 0,
})
export function usePlaybackTime(): PlaybackTimeState {
  return useContext(PlaybackTimeCtx)
}

// ---- 墙专用低频上下文：只含墙上卡片/背景层真正订阅的字段 ----
// usePlayback 的 value 里混着 volume / history / playMode / isFallback 等：
// 音量滑块拖动是「每个 pointermove 一次 setState」，若卡片直接订阅 usePlayback，
// 一次拖动 = 几十张 MusicCard × 每 move 全量重渲染（安卓主线程直接被拖垮）。
// 这里只挑墙需要的字段单独成 context：value 仅在 切歌 / 播放暂停 / 收藏增减 时
// 变化 —— 这些时刻卡片本来就该重渲染，其余高频状态全部隔离在外。
export type PlaybackWallState = {
  currentTrack: Track | null
  isPlaying: boolean
  togglePlay: (id?: string) => void
  prev: () => void
  next: () => void
  isFavorite: (id: string) => boolean
  toggleFavorite: (id: string) => void
  getAudioIntensity: () => number
}
const PlaybackWallCtx = createContext<PlaybackWallState | null>(null)
export function usePlaybackWall(): PlaybackWallState {
  const ctx = useContext(PlaybackWallCtx)
  if (!ctx) throw new Error("usePlaybackWall must be used inside <PlaybackProvider>")
  return ctx
}

// 单独的低频上下文：只承载曲目列表（仅在用户曲目加载/切换时变化）。
// 重量级的 MusicCanvas 用它、而非 usePlayback —— 避免被 timeupdate 引发的
// 高频 value 重建波及到每帧渲染。
type TrackSourceCtx = {
  tracks: Track[]
  source: MusicSource
  setSource: (s: MusicSource) => void
  hasUserTracks: boolean
}
const PlaybackTracksCtx = createContext<TrackSourceCtx>({
  tracks: DEFAULT_TRACKS,
  source: "mine",
  setSource: () => {},
  hasUserTracks: false,
})
// 只取曲目列表（MusicCanvas / ExpandedCard 用，避免被高频 value 波及）。
export function useTracks(): Track[] {
  return useContext(PlaybackTracksCtx).tracks
}
// 取「我的 / 精选」切换信息（SourceToggle 用）。
export function useTrackSource(): TrackSourceCtx {
  return useContext(PlaybackTracksCtx)
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const { user } = useSimpleAuth()
  const { toast } = useToast()
  // Provider 现在挂在全局（跨页面后台续播），但 Space / ←/→ 快捷键只应在
  // music 页生效——否则一旦播过歌，在论坛里按空格会被劫持成播放/暂停、
  // 破坏页面默认的空格滚动。用 pathname 把快捷键限定在 /music。
  const pathname = usePathname()

  // 运行时曲目源。userTracks = 当前用户的自定义曲目（空 = 没有 / 游客）。
  // source = 墙当前显示「我的」还是「精选」，持久化；有自定义曲目时才有意义。
  // 实际渲染的 tracks 由两者派生：选「我的」且有曲目 → 用户的，否则精选默认墙。
  const [userTracks, setUserTracks] = useState<Track[]>([])
  const [source, setSourceState] = useState<MusicSource>("mine")
  const hasUserTracks = userTracks.length > 0
  const tracks = useMemo<Track[]>(
    () => (source === "mine" && userTracks.length > 0 ? userTracks : DEFAULT_TRACKS),
    [source, userTracks],
  )
  const tracksRef = useRef<Track[]>(tracks)
  useEffect(() => {
    tracksRef.current = tracks
  }, [tracks])

  const setSource = useCallback((s: MusicSource) => {
    setSourceState(s)
    try {
      localStorage.setItem(SOURCE_KEY, s)
    } catch {
      /* ignore */
    }
  }, [])
  // 载入持久化的「我的/精选」偏好
  useEffect(() => {
    try {
      const v = localStorage.getItem(SOURCE_KEY)
      if (v === "mine" || v === "featured") setSourceState(v)
    } catch {
      /* ignore */
    }
  }, [])

  // Audio element kept in a ref so a single instance lives for the lifetime
  // of the page (created in useEffect to keep SSR happy).
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // ---- 音频拉取冷却 / 复用状态（配合顶部 REUSE_TTL / MIN_GAP / MAX_RESOLVES_PER_MIN）----
  const loadedIdRef = useRef<string | null>(null)            // 真正 load 进 <audio> 的曲目 id
  const lastResolveAtRef = useRef<Map<string, number>>(new Map())
  const lastAnyResolveAtRef = useRef(0)
  const resolveTimesRef = useRef<number[]>([])               // 滚动窗口：近 1min 内的解析时刻
  const pendingTimerRef = useRef<number | null>(null)        // 最小间隔防抖定时器

  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0) // 已缓冲（加载）到的时长（秒）
  const [isFallback, setIsFallback] = useState(false)
  const [volume, setVolumeState] = useState(1) // 播放音量 [0,1]
  // volumeRef：供 [] 依赖的音频 init effect 读取最新初值（避免把 volume 放进其依赖）。
  const volumeRef = useRef(1)
  // timeValue 用 useMemo 避免每次 render 都新建对象 → 避免 TimeCtx 消费者无谓重渲染
  const [playMode, setPlayModeState] = useState<PlayMode>("list")
  // playModeRef / nextRef：供 [] 依赖的音频初始化 effect 里的 onEnded 读到最新值。
  const playModeRef = useRef<PlayMode>("list")
  const nextRef = useRef<() => void>(() => {})
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  // Track which track is currently loading so the error handler knows whether
  // to attempt the fallback for THIS attempt (not a stale previous one).
  const playSeqRef = useRef(0)
  const fallbackTriedRef = useRef<Set<number>>(new Set())
  // 实例回退状态（按 playSeq 一份）：首次报错时基于当时的 src 算出其它 meting
  // 实例上的同构 URL 列表，之后每次报错顺序取下一个重试；列表耗尽才判"音源不可用"。
  const metingRetryRef = useRef<{ seq: number; alts: string[]; next: number } | null>(null)
  // 探测出的健康 meting 实例域名（见 metingInstances.ts）。解析时把存库/烘焙的
  // audio_url 改写到该实例，使手势内的首次 play() 直接命中可用实例 —— iOS 不支持
  // error 处理器里的非手势回退 play()，必须靠这条前置改写。
  // 冷启动竞态：探测是异步的，首次打开页面若在探测返回前就点歌，ref 还没更新会
  // 用到坏实例（iOS 上第一首放不出、第二首才行）。为此分三层兜底，越靠前越早就绪：
  //   ① 初值 = 实例表首位（同步、瞬时，列表已把当前最可靠的放首位）；
  //   ② 挂载即同步读 localStorage 上次探测结果覆盖①（仅当新鲜，见 HEALTHY_BASE_TTL）；
  //   ③ 探测完成后更新 ref 并写回 localStorage（自愈 + 供下次冷启动用）。
  const healthyBaseRef = useRef<string>(METING_INSTANCES[0])
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HEALTHY_BASE_KEY)
      if (raw) {
        const cached = JSON.parse(raw) as { base?: string; at?: number }
        // 仅采信「已知实例 + 新鲜」的缓存；旧缓存忽略、退回 ref 初值（构建默认＝
        // 列表首位），由下面的探测最终校正。
        if (
          cached?.base &&
          (METING_INSTANCES as readonly string[]).includes(cached.base) &&
          typeof cached.at === "number" &&
          Date.now() - cached.at < HEALTHY_BASE_TTL
        ) {
          healthyBaseRef.current = cached.base
        }
      }
    } catch {
      /* ignore（含旧的纯字符串格式 v1：JSON.parse 失败即忽略，探测会写回新格式） */
    }
    let alive = true
    pickHealthyMetingBase().then((base) => {
      if (!alive) return
      healthyBaseRef.current = base
      try {
        localStorage.setItem(HEALTHY_BASE_KEY, JSON.stringify({ base, at: Date.now() }))
      } catch {
        /* ignore */
      }
    })
    return () => {
      alive = false
    }
  }, [])

  // ---- Audio-reactive visuals (simulated pulse only) ----
  //
  // We intentionally do NOT use Web Audio (AnalyserNode + createMediaElement
  // Source) here. The NetEase CDN audio we stream via the Meting proxy is
  // cross-origin without CORS headers; the moment you pipe such an audio
  // element through createMediaElementSource(), Chrome's security model
  // SILENCES the entire output as a side channel mitigation — and the source
  // node cannot be removed afterwards. So we'd lose audio playback entirely.
  //
  // Instead we drive the visual pulse with a layered sine wave. It's not
  // truly synced to the beat, but it "breathes" in a way that reads as
  // musical, and crucially the user can hear the song.
  const smoothedIntensityRef = useRef(0)
  const isPlayingRef = useRef(false)

  // 解析当前曲目：先在当前墙找，找不到再到用户库 / 精选库找 ——
  // 这样切换「我的/精选」时，正在播放的那首仍能被解析、播放器不消失。
  const currentTrack = useMemo(() => {
    if (!currentTrackId) return null
    return (
      tracks.find((t) => t.id === currentTrackId) ??
      userTracks.find((t) => t.id === currentTrackId) ??
      DEFAULT_TRACKS.find((t) => t.id === currentTrackId) ??
      null
    )
  }, [currentTrackId, tracks, userTracks])

  // 把 DB 行套进用户库（是否显示由 source 派生决定）。
  const applyUserTracks = useCallback((rows: UserMusicTrackRow[]) => {
    setUserTracks(userRowsToTracks(rows))
  }, [])

  // 手动刷新：编辑器增删改后调用，让墙立即同步。
  const refreshTracks = useCallback(async () => {
    if (!user?.id) {
      setUserTracks([])
      return
    }
    try {
      applyUserTracks(await getUserMusicTracks(user.id))
    } catch {
      /* 保持当前，不打断播放 */
    }
  }, [user?.id, applyUserTracks])

  // 拉取当前用户的自定义曲目。按 user_id 一次性查询（单分区索引命中），不订阅 realtime。
  useEffect(() => {
    let cancelled = false
    if (!user?.id) {
      setUserTracks([])
      return
    }
    getUserMusicTracks(user.id)
      .then((rows) => {
        if (!cancelled) applyUserTracks(rows)
      })
      .catch(() => {
        if (!cancelled) setUserTracks([])
      })
    return () => {
      cancelled = true
    }
  }, [user?.id, applyUserTracks])

  // ---- Load history from localStorage on mount ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (raw) setHistory(JSON.parse(raw))
    } catch {
      /* ignore */
    }
  }, [])

  // ---- Persist history when it changes ----
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
    } catch {
      /* ignore quota errors */
    }
  }, [history])

  // ---- Load favorites from localStorage on mount ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setFavorites(parsed.filter((x) => typeof x === "string"))
      }
    } catch {
      /* ignore */
    }
  }, [])

  // ---- Persist favorites when they change ----
  useEffect(() => {
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites))
    } catch {
      /* ignore quota errors */
    }
  }, [favorites])

  // playModeRef 同步，供 onEnded 读取最新模式。
  useEffect(() => {
    playModeRef.current = playMode
  }, [playMode])

  const setPlayMode = useCallback((m: PlayMode) => {
    setPlayModeState(m)
    try {
      localStorage.setItem(PLAY_MODE_KEY, m)
    } catch {
      /* ignore */
    }
  }, [])

  // ---- 载入持久化的播放模式 ----
  useEffect(() => {
    try {
      const v = localStorage.getItem(PLAY_MODE_KEY)
      if (v === "list" || v === "one" || v === "once") setPlayModeState(v)
    } catch {
      /* ignore */
    }
  }, [])

  const [lyricsEnabled, setLyricsEnabledState] = useState(true)
  const setLyricsEnabled = useCallback((on: boolean) => {
    setLyricsEnabledState(on)
    try {
      localStorage.setItem(LYRICS_KEY, on ? "1" : "0")
    } catch {
      /* ignore */
    }
  }, [])

  // ---- 载入持久化的歌词开关（默认开） ----
  useEffect(() => {
    try {
      if (localStorage.getItem(LYRICS_KEY) === "0") setLyricsEnabledState(false)
    } catch {
      /* ignore */
    }
  }, [])

  const [liquidFx, setLiquidFxState] = useState<LiquidFx>("rain")
  const setLiquidFx = useCallback((m: LiquidFx) => {
    setLiquidFxState(m)
    try {
      localStorage.setItem(LIQUID_FX_KEY, m)
    } catch {
      /* ignore */
    }
  }, [])

  // ---- 载入持久化的液面律动模式（默认 rain） ----
  useEffect(() => {
    try {
      const v = localStorage.getItem(LIQUID_FX_KEY)
      if (v === "rain" || v === "center" || v === "off") setLiquidFxState(v)
    } catch {
      /* ignore */
    }
  }, [])

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    setVolumeState(clamped)
    const el = audioRef.current
    if (el) el.volume = clamped // 立即生效，拖动手感不延迟
    try {
      localStorage.setItem(VOLUME_KEY, String(clamped))
    } catch {
      /* ignore */
    }
  }, [])

  // ---- 载入持久化的音量 ----
  useEffect(() => {
    try {
      const v = localStorage.getItem(VOLUME_KEY)
      if (v !== null) {
        const n = parseFloat(v)
        if (isFinite(n) && n >= 0 && n <= 1) setVolumeState(n)
      }
    } catch {
      /* ignore */
    }
  }, [])

  // ---- 驱动原生 loop：单曲循环用 <audio> 内建 loop（无缝、不走 ended 往返）----
  useEffect(() => {
    const el = audioRef.current
    if (el) el.loop = playMode === "one"
  }, [playMode])

  // ---- Init audio element + bind listeners once ----
  useEffect(() => {
    const el = new Audio()
    el.preload = "metadata"
    el.volume = volumeRef.current // 套用持久化音量初值（后续变化由独立 effect 同步）
    audioRef.current = el

    // 已缓冲时长 = 最后一段 buffered 区间的末端（顺序下载时即"从头加载到哪"）。
    const updateBuffered = () => {
      const b = el.buffered
      setBuffered(b.length > 0 ? b.end(b.length - 1) : 0)
    }
    // timeupdate 在浏览器里 4–66Hz 触发，每次 setCurrentTime 会让所有 usePlayback 消费者
    // 重渲染（含 MusicPlayer 的 backdrop-filter 面板）。人眼看进度条 4Hz 已足够顺滑，
    // 故节流到 ~240ms。但"大跳变"（>1s，代表切歌/seek/循环结束）必须立即同步，
    // 否则会看到进度条停在旧值一瞬间再跳。
    let lastSetAt = 0
    let lastSetVal = 0
    const onTime = () => {
      const now = performance.now()
      const t = el.currentTime
      const big = Math.abs(t - lastSetVal) > 1
      if (big || now - lastSetAt >= 240) {
        lastSetAt = now
        lastSetVal = t
        setCurrentTime(t)
      }
      updateBuffered()
    }
    // 流媒体跨缓冲 seek 时，部分浏览器会让 duration 瞬间变 Infinity/NaN，
    // 而进度条是 currentTime/duration —— 时长一塌成无效值进度条就归零。
    // 故只接受有效时长，否则保留上一次的好值。
    const onDuration = () => {
      const d = el.duration
      if (isFinite(d) && d > 0) setDuration(d)
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => {
      // 防伪 ended：跨越缓冲区/末端的 seek 在部分浏览器会触发 ended，但此时并未真正
      // 播到结尾 —— 仅当确实接近结尾才处理，避免进度条/播放被错误重置回开头。
      const d = el.duration
      if (isFinite(d) && d > 0 && el.currentTime < d - 1.5) return
      // 单曲循环走原生 el.loop，根本不触发 ended。
      if (playModeRef.current === "list") {
        // 列表循环：自动下一首（next 内部对末尾取模、回到开头）。
        setCurrentTime(0)
        nextRef.current()
        return
      }
      // 播完就暂停（once）：停在原地。
      setIsPlaying(false)
      isPlayingRef.current = false
      setCurrentTime(0)
    }
    // 音源解析失败（实例挂 / 404 / CORS / 区域 / VIP / 链接失效）：
    // 先做实例回退——src 若是已知 meting 实例的 URL，把域名换到下一个实例重试
    // （存库的 audio_url 钉死在导入时用的实例上，该实例挂掉时其它实例往往是好的）；
    // 所有实例都试完仍失败，才标记"音源不可用"提示一次，由用户换一首。
    // 判死按 playSeq 去重，避免重复弹提示。
    const onError = () => {
      const seq = playSeqRef.current
      if (fallbackTriedRef.current.has(seq)) return

      // 本次播放第一次报错时算出备选列表（基于报错时的 src，含原实例之外的全部实例）
      if (!metingRetryRef.current || metingRetryRef.current.seq !== seq) {
        metingRetryRef.current = { seq, alts: metingAlternatives(el.src), next: 0 }
      }
      const retry = metingRetryRef.current
      if (retry.next < retry.alts.length) {
        const alt = retry.alts[retry.next]
        retry.next += 1
        el.src = alt
        el.play().catch(() => {
          // 播放被拒/再次加载失败 → 下一次 error 事件继续走回退或判死
        })
        return
      }

      fallbackTriedRef.current.add(seq)
      setIsFallback(true)
      setIsPlaying(false)
      isPlayingRef.current = false
      toast({ description: "音源暂不可用，换一首试试" })
    }

    el.addEventListener("timeupdate", onTime)
    el.addEventListener("progress", updateBuffered)
    el.addEventListener("loadedmetadata", onDuration)
    el.addEventListener("durationchange", onDuration)
    el.addEventListener("play", onPlay)
    el.addEventListener("pause", onPause)
    el.addEventListener("ended", onEnded)
    el.addEventListener("error", onError)

    // Keep a ref-side mirror of isPlaying so getAudioIntensity (which is
    // called from rAF) can read it without triggering re-renders.
    const onPlayMirror = () => { isPlayingRef.current = true }
    const onPauseMirror = () => { isPlayingRef.current = false }
    el.addEventListener("play", onPlayMirror)
    el.addEventListener("pause", onPauseMirror)
    el.addEventListener("ended", onPauseMirror)

    return () => {
      el.pause()
      el.removeEventListener("timeupdate", onTime)
      el.removeEventListener("progress", updateBuffered)
      el.removeEventListener("loadedmetadata", onDuration)
      el.removeEventListener("durationchange", onDuration)
      el.removeEventListener("play", onPlay)
      el.removeEventListener("pause", onPause)
      el.removeEventListener("ended", onEnded)
      el.removeEventListener("error", onError)
      el.removeEventListener("play", onPlayMirror)
      el.removeEventListener("pause", onPauseMirror)
      el.removeEventListener("ended", onPauseMirror)
      audioRef.current = null
    }
  }, [])

  // ---- 音量：同步 ref（供 init effect 取初值）+ 写入 <audio>（后续变化兜底）----
  useEffect(() => {
    volumeRef.current = volume
    const el = audioRef.current
    if (el) el.volume = volume
  }, [volume])

  // Lazily create the AudioContext on the first play (user gesture is
  // required by browsers — play() click qualifies).
  // STUB: kept for callsite compatibility, intentionally a no-op now. See the
  // long comment near the ref declarations for why Web Audio is disabled.
  const pushHistory = useCallback((trackId: string) => {
    setHistory((h) => {
      // Move-to-front: remove existing entries for this track, then prepend.
      const filtered = h.filter((e) => e.trackId !== trackId)
      return [{ trackId, playedAt: Date.now() }, ...filtered].slice(0, HISTORY_LIMIT)
    })
  }, [])

  // 真正把音频 load 进 <audio> 并播放 + 记账。仅在通过冷却闸门后调用。
  const doResolve = useCallback(
    (track: Track) => {
      const el = audioRef.current
      if (!el) return
      // Bump sequence so the error handler treats this as a fresh attempt
      // (allows fallback to run again for this new track).
      playSeqRef.current += 1
      setIsFallback(false)
      // 改写到健康实例：把烘焙/存库里钉死在某实例上的 audio_url 换到当前可用实例，
      // 保证手势内首次 play() 命中可用源（iOS 关键路径）。healthyBaseRef 永不为空
      // （初值=实例表首位，再被 localStorage 缓存 / 探测结果覆盖）。
      el.src = rewriteMetingBase(track.audio, healthyBaseRef.current)
      el.currentTime = 0
      setBuffered(0) // 换曲：缓冲条清零
      loadedIdRef.current = track.id
      const t = Date.now()
      lastResolveAtRef.current.set(track.id, t)
      lastAnyResolveAtRef.current = t
      resolveTimesRef.current.push(t)
      pushHistory(track.id)
      el.play().catch(() => {
        // autoplay blocked or load error — error handler will deal with it.
      })
    },
    [pushHistory],
  )

  const play = useCallback(
    (id: string) => {
      const track = tracksRef.current.find((t) => t.id === id)
      const el = audioRef.current
      if (!track || !el) return

      const now = Date.now()

      // ① 复用窗口：当前已 load 的就是这首、且窗口内已拉过 → 直接续播，
      //    不重置 src、不再打外部源（"多久前已拉过就先用着"）。
      const lastResolve = lastResolveAtRef.current.get(id) ?? 0
      if (loadedIdRef.current === id && el.src && now - lastResolve < REUSE_TTL) {
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current)
          pendingTimerRef.current = null
        }
        setCurrentTrackId(id)
        el.play().catch(() => {})
        return
      }

      // ② 每分钟解析上限（滚动窗口）——硬安全网，防脚本刷。
      const windowStart = now - 60_000
      resolveTimesRef.current = resolveTimesRef.current.filter((x) => x > windowStart)
      if (resolveTimesRef.current.length >= MAX_RESOLVES_PER_MIN) {
        toast({ description: "操作太频繁，请稍候再切歌" })
        return
      }

      // ③ 最小间隔：太快 → 防抖，把连点合并成"只解析最后落定的那一首"。
      setCurrentTrackId(id) // 乐观更新 UI，音频随后跟上
      const sinceLast = now - lastAnyResolveAtRef.current
      if (sinceLast < MIN_GAP) {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
        pendingTimerRef.current = window.setTimeout(() => {
          pendingTimerRef.current = null
          const tk = tracksRef.current.find((t) => t.id === id)
          if (tk) doResolve(tk)
        }, MIN_GAP - sinceLast)
        return
      }

      doResolve(track)
    },
    [doResolve, toast],
  )

  const pause = useCallback(() => {
    audioRef.current?.pause()
  }, [])

  const togglePlay = useCallback(
    (id?: string) => {
      const el = audioRef.current
      if (!el) return
      // If id given and not current, switch to that track.
      if (id && id !== currentTrackId) {
        play(id)
        return
      }
      // Otherwise toggle the current.
      if (el.paused) {
        if (currentTrackId) {
          el.play().catch(() => {})
        }
      } else {
        el.pause()
      }
    },
    [currentTrackId, play],
  )

  const seek = useCallback((t: number) => {
    const el = audioRef.current
    if (!el) return
    if (!isFinite(t) || t < 0) return
    el.currentTime = t
    // 乐观更新：进度条立刻到位，不等下一次 timeupdate（也避免松手瞬间闪回旧值）。
    setCurrentTime(t)
  }, [])

  const indexOfCurrent = useMemo(
    () => (currentTrackId ? tracks.findIndex((t) => t.id === currentTrackId) : -1),
    [currentTrackId, tracks],
  )

  const next = useCallback(() => {
    const list = tracksRef.current
    if (indexOfCurrent < 0 || list.length === 0) return
    const nextTrack = list[(indexOfCurrent + 1) % list.length]
    play(nextTrack.id)
  }, [indexOfCurrent, play])

  const prev = useCallback(() => {
    const list = tracksRef.current
    if (indexOfCurrent < 0 || list.length === 0) return
    const prevTrack = list[(indexOfCurrent - 1 + list.length) % list.length]
    play(prevTrack.id)
  }, [indexOfCurrent, play])

  // nextRef 同步，供 onEnded（列表循环自动下一首）读取最新的 next。
  useEffect(() => {
    nextRef.current = next
  }, [next])

  const clearHistory = useCallback(() => setHistory([]), [])

  // ---- Global keyboard shortcuts ----
  // Space = play/pause, ArrowLeft = prev, ArrowRight = next.
  // Ignored while focus is on a text input (so search-in-library still works).
  // 仅在 music 页绑定：provider 现在是全局的，不能在其他页面劫持空格/方向键。
  useEffect(() => {
    if (pathname !== "/music") return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return
      }
      if (e.key === " " || e.code === "Space") {
        if (!currentTrackId) return
        e.preventDefault()
        togglePlay()
      } else if (e.key === "ArrowLeft") {
        if (!currentTrackId) return
        e.preventDefault()
        prev()
      } else if (e.key === "ArrowRight") {
        if (!currentTrackId) return
        e.preventDefault()
        next()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pathname, currentTrackId, togglePlay, prev, next])

  // ---- Favorites ----
  // Lookup via a Set so isFavorite() is O(1) — important because every card
  // and panel polls it on each render.
  const favoritesSet = useMemo(() => new Set(favorites), [favorites])
  const isFavorite = useCallback(
    (id: string) => favoritesSet.has(id),
    [favoritesSet],
  )
  const toggleFavorite = useCallback((id: string) => {
    setFavorites((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur],
    )
  }, [])

  // 卸载时清掉未触发的防抖定时器
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current)
    }
  }, [])

  const getAudioIntensity = useCallback((): number => {
    // Steady "normal" when paused / no track — no pulse.
    if (!isPlayingRef.current) {
      smoothedIntensityRef.current = 1
      return 1
    }
    // Layered sine pulse: a ~0.5 Hz beat shaped by a slower 0.09 Hz envelope.
    // ~2s per breath in, 2s out — relaxed "ambient breathing" rather than
    // a metronomic dance pulse.
    const t = performance.now() / 1000
    const beat = (Math.sin(t * Math.PI * 2 * 0.5) + 1) / 2
    const env = (Math.sin(t * Math.PI * 2 * 0.09) + 1) / 2 * 0.4 + 0.6
    const raw = beat * env
    smoothedIntensityRef.current =
      smoothedIntensityRef.current * 0.55 + raw * 0.45
    return smoothedIntensityRef.current
  }, [])

  const timeValue = useMemo<PlaybackTimeState>(
    () => ({ currentTime, duration, buffered }),
    [currentTime, duration, buffered],
  )

  const value: PlaybackState = useMemo(
    () => ({
      currentTrack,
      isPlaying,
      isFallback,
      playMode,
      history,
      favorites,
      tracks,
      play,
      pause,
      togglePlay,
      seek,
      next,
      prev,
      clearHistory,
      isFavorite,
      toggleFavorite,
      setPlayMode,
      volume,
      setVolume,
      lyricsEnabled,
      setLyricsEnabled,
      liquidFx,
      setLiquidFx,
      getAudioIntensity,
      refreshTracks,
    }),
    [currentTrack, isPlaying, isFallback, playMode, history, favorites, tracks, play, pause, togglePlay, seek, next, prev, clearHistory, isFavorite, toggleFavorite, setPlayMode, volume, setVolume, lyricsEnabled, setLyricsEnabled, liquidFx, setLiquidFx, getAudioIntensity, refreshTracks],
  )

  const tracksCtxValue = useMemo<TrackSourceCtx>(
    () => ({ tracks, source, setSource, hasUserTracks }),
    [tracks, source, setSource, hasUserTracks],
  )

  // 墙专用 value：依赖刻意收窄（见 PlaybackWallCtx 注释）。volume/history/
  // playMode/时间心跳都不在依赖里，不会触发墙的重渲染。
  const wallValue = useMemo<PlaybackWallState>(
    () => ({
      currentTrack,
      isPlaying,
      togglePlay,
      prev,
      next,
      isFavorite,
      toggleFavorite,
      getAudioIntensity,
    }),
    [currentTrack, isPlaying, togglePlay, prev, next, isFavorite, toggleFavorite, getAudioIntensity],
  )

  return (
    <PlaybackCtx.Provider value={value}>
      <PlaybackTimeCtx.Provider value={timeValue}>
        <PlaybackWallCtx.Provider value={wallValue}>
          <PlaybackTracksCtx.Provider value={tracksCtxValue}>{children}</PlaybackTracksCtx.Provider>
        </PlaybackWallCtx.Provider>
      </PlaybackTimeCtx.Provider>
    </PlaybackCtx.Provider>
  )
}
