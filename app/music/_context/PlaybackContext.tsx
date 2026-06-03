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
import { DEFAULT_TRACKS, type Track } from "../_data/tracks"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import { getUserMusicTracks, type UserMusicTrackRow } from "@/lib/supabase"
import { userRowsToTracks } from "../_lib/userTracks"

const HISTORY_KEY = "music-history-v1"
const HISTORY_LIMIT = 50
const FAVORITES_KEY = "music-favorites-v1"
const REPEAT_ONE_KEY = "music-repeat-one-v1"
const SOURCE_KEY = "music-source-v1"

// 墙的曲目源：「我的」自定义 vs「精选」默认墙。
export type MusicSource = "mine" | "featured"

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
  currentTime: number
  duration: number
  isFallback: boolean      // true when the current track's audio source is unavailable
  /** Single-track repeat: when on, the current track loops seamlessly. Persisted. */
  repeatOne: boolean
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
  /** Toggle single-track repeat on/off. */
  toggleRepeatOne: () => void
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
  const [isFallback, setIsFallback] = useState(false)
  const [repeatOne, setRepeatOne] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  // Track which track is currently loading so the error handler knows whether
  // to attempt the fallback for THIS attempt (not a stale previous one).
  const playSeqRef = useRef(0)
  const fallbackTriedRef = useRef<Set<number>>(new Set())

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

  // ---- Load single-track repeat preference on mount ----
  useEffect(() => {
    try {
      if (localStorage.getItem(REPEAT_ONE_KEY) === "1") setRepeatOne(true)
    } catch {
      /* ignore */
    }
  }, [])

  // ---- Persist repeat preference + drive the native `loop` flag ----
  // Using the audio element's built-in `loop` gives a seamless gapless repeat
  // (no `ended` round-trip), and it persists across `src` reassignment so we
  // only need to sync it when the preference itself changes.
  useEffect(() => {
    try {
      localStorage.setItem(REPEAT_ONE_KEY, repeatOne ? "1" : "0")
    } catch {
      /* ignore quota errors */
    }
    const el = audioRef.current
    if (el) el.loop = repeatOne
  }, [repeatOne])

  // ---- Init audio element + bind listeners once ----
  useEffect(() => {
    const el = new Audio()
    el.preload = "metadata"
    audioRef.current = el

    const onTime = () => setCurrentTime(el.currentTime)
    const onDuration = () => setDuration(el.duration || 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }
    // 音源解析失败（injahow 挂 / 404 / CORS / 区域 / VIP / 链接失效）：
    // 不再播放本地占位音频，而是标记该曲"音源不可用"并提示一次，由用户换一首。
    // 每个 play() 尝试只处理一次（按 playSeq 去重，避免重复弹提示）。
    const onError = () => {
      const seq = playSeqRef.current
      if (fallbackTriedRef.current.has(seq)) return
      fallbackTriedRef.current.add(seq)
      setIsFallback(true)
      setIsPlaying(false)
      isPlayingRef.current = false
      toast({ description: "音源暂不可用，换一首试试" })
    }

    el.addEventListener("timeupdate", onTime)
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
      el.src = track.audio
      el.currentTime = 0
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

  const clearHistory = useCallback(() => setHistory([]), [])

  // ---- Global keyboard shortcuts ----
  // Space = play/pause, ArrowLeft = prev, ArrowRight = next.
  // Ignored while focus is on a text input (so search-in-library still works).
  useEffect(() => {
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
  }, [currentTrackId, togglePlay, prev, next])

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

  const toggleRepeatOne = useCallback(() => setRepeatOne((v) => !v), [])

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

  const value: PlaybackState = useMemo(
    () => ({
      currentTrack,
      isPlaying,
      currentTime,
      duration,
      isFallback,
      repeatOne,
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
      toggleRepeatOne,
      getAudioIntensity,
      refreshTracks,
    }),
    [currentTrack, isPlaying, currentTime, duration, isFallback, repeatOne, history, favorites, tracks, play, pause, togglePlay, seek, next, prev, clearHistory, isFavorite, toggleFavorite, toggleRepeatOne, getAudioIntensity, refreshTracks],
  )

  const tracksCtxValue = useMemo<TrackSourceCtx>(
    () => ({ tracks, source, setSource, hasUserTracks }),
    [tracks, source, setSource, hasUserTracks],
  )

  return (
    <PlaybackCtx.Provider value={value}>
      <PlaybackTracksCtx.Provider value={tracksCtxValue}>{children}</PlaybackTracksCtx.Provider>
    </PlaybackCtx.Provider>
  )
}
