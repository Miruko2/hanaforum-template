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
import { TRACKS, type Track } from "../_data/tracks"

const HISTORY_KEY = "music-history-v1"
const HISTORY_LIMIT = 50
const FAVORITES_KEY = "music-favorites-v1"
const FALLBACK_AUDIO = "/cover.mp3" // local placeholder when remote audio fails (region/VIP/etc.)

export type HistoryEntry = {
  trackId: string
  playedAt: number
}

export type PlaybackState = {
  currentTrack: Track | null
  isPlaying: boolean
  currentTime: number
  duration: number
  isFallback: boolean      // true when current track is using the placeholder audio
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
}

const PlaybackCtx = createContext<PlaybackState | null>(null)

export function usePlayback(): PlaybackState {
  const ctx = useContext(PlaybackCtx)
  if (!ctx) throw new Error("usePlayback must be used inside <PlaybackProvider>")
  return ctx
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  // Audio element kept in a ref so a single instance lives for the lifetime
  // of the page (created in useEffect to keep SSR happy).
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isFallback, setIsFallback] = useState(false)
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

  const currentTrack = useMemo(
    () => (currentTrackId ? TRACKS.find((t) => t.id === currentTrackId) ?? null : null),
    [currentTrackId],
  )

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
    // When the remote URL fails (404 / CORS / region block / VIP wall),
    // swap to the local placeholder ONCE per play() attempt.
    const onError = () => {
      const seq = playSeqRef.current
      if (fallbackTriedRef.current.has(seq)) return
      fallbackTriedRef.current.add(seq)
      setIsFallback(true)
      el.src = FALLBACK_AUDIO
      el.currentTime = 0
      el.play().catch(() => {})
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

  const play = useCallback(
    (id: string) => {
      const track = TRACKS.find((t) => t.id === id)
      const el = audioRef.current
      if (!track || !el) return
      // Bump sequence so the error handler treats this as a fresh attempt
      // (allows fallback to run again for this new track).
      playSeqRef.current += 1
      setIsFallback(false)
      // Always reset src — even when re-playing the same track — because
      // injahow proxy URLs may have expired tokens after a long pause.
      el.src = track.audio
      el.currentTime = 0
      setCurrentTrackId(id)
      pushHistory(id)
      el.play().catch(() => {
        // autoplay blocked or load error — error handler will deal with it.
      })
    },
    [pushHistory],
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
    () => (currentTrackId ? TRACKS.findIndex((t) => t.id === currentTrackId) : -1),
    [currentTrackId],
  )

  const next = useCallback(() => {
    if (indexOfCurrent < 0) return
    const nextTrack = TRACKS[(indexOfCurrent + 1) % TRACKS.length]
    play(nextTrack.id)
  }, [indexOfCurrent, play])

  const prev = useCallback(() => {
    if (indexOfCurrent < 0) return
    const prevTrack = TRACKS[(indexOfCurrent - 1 + TRACKS.length) % TRACKS.length]
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
      history,
      favorites,
      tracks: TRACKS,
      play,
      pause,
      togglePlay,
      seek,
      next,
      prev,
      clearHistory,
      isFavorite,
      toggleFavorite,
      getAudioIntensity,
    }),
    [currentTrack, isPlaying, currentTime, duration, isFallback, history, favorites, play, pause, togglePlay, seek, next, prev, clearHistory, isFavorite, toggleFavorite, getAudioIntensity],
  )

  return <PlaybackCtx.Provider value={value}>{children}</PlaybackCtx.Provider>
}
