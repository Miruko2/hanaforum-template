"use client"

import { useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Search, X, ChevronRight, History as HistoryIcon, Music2, Play, Pause, Trash2, Heart } from "lucide-react"
import { usePlayback } from "../_context/PlaybackContext"
import type { Track } from "../_data/tracks"
import { useIsAndroid } from "../_lib/useIsAndroid"
import { TrackCover } from "./TrackCover"

type Props = {
  open: boolean
  onOpen: () => void
  onClose: () => void
}

export function HistoryPanel({ open, onOpen, onClose }: Props) {
  const { history, favorites, tracks, currentTrack, isPlaying, play, togglePlay, clearHistory } = usePlayback()
  // 安卓 WebView：backdrop-filter + 动画化 filter:blur 叠加会撕裂合成层（碎裂闪）；
  // 且 overlayOpen 时 canvas 已隐藏、抽屉背后本就纯黑、毛玻璃无效 —— 安卓改实底背景
  // + 列表切换动画去掉 filter:blur。其它平台保留毛玻璃 + 高斯凝结过渡。
  // useIsAndroid 同步首帧即正确（见 _lib/useIsAndroid）：它驱动列表 motion.div 的 initial
  // filter，首帧必须为真值，否则切到无 filter 变体时 framer-motion 撒手不管 filter →
  // blur 卡死、列表永久模糊（已踩坑，桌面复现不到）。
  const isAndroid = useIsAndroid()
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<"favorites" | "history" | "all">("history")
  // Mac-Dock-style sliding highlight that follows the hovered tab.
  const tabContainerRef = useRef<HTMLDivElement | null>(null)
  const tabBtnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [hoverRect, setHoverRect] = useState<{ x: number; w: number } | null>(null)
  const onTabHover = (idx: number) => {
    const c = tabContainerRef.current
    const btn = tabBtnRefs.current[idx]
    if (!c || !btn) return
    const cRect = c.getBoundingClientRect()
    const bRect = btn.getBoundingClientRect()
    setHoverRect({ x: bRect.left - cRect.left, w: bRect.width })
  }

  const trackById = useMemo(() => {
    const m = new Map<string, Track>()
    tracks.forEach((t) => m.set(t.id, t))
    return m
  }, [tracks])

  const historyTracks = useMemo(
    () =>
      history
        .map((h) => ({ entry: h, track: trackById.get(h.trackId) }))
        .filter((x): x is { entry: typeof history[number]; track: Track } => Boolean(x.track)),
    [history, trackById],
  )

  const favoriteTracks = useMemo(
    () =>
      favorites
        .map((id) => trackById.get(id))
        .filter((t): t is Track => Boolean(t)),
    [favorites, trackById],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return tracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q),
    )
  }, [query, tracks])

  // 列表视图切换动画：安卓去掉 filter:blur（见上方 isAndroid 注释），仅淡入淡出。
  const listAnim = isAndroid
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, filter: "blur(20px)" },
        animate: { opacity: 1, filter: "blur(0px)" },
        exit: { opacity: 0, filter: "blur(20px)" },
      }

  return (
    <>
      {/* Drawer */}
      <aside
        className="fixed top-0 right-0 z-[55] flex h-full w-[360px] max-w-[88vw] flex-col text-white transition-transform duration-300 ease-out"
        style={{
          transform: open ? "translateX(0)" : "translateX(100%)",
          // 安卓：实底（抽屉背后已纯黑，毛玻璃无效）；其它平台：毛玻璃。
          background: isAndroid ? "rgba(24,24,27,0.94)" : "rgba(255,255,255,0.05)",
          backdropFilter: isAndroid ? undefined : "blur(32px) saturate(140%)",
          WebkitBackdropFilter: isAndroid ? undefined : "blur(32px) saturate(140%)",
          boxShadow:
            "0 0 80px -10px rgba(0,0,0,0.5), inset 1px 0 0 rgba(255,255,255,0.12)",
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        aria-hidden={!open}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <HistoryIcon size={16} className="text-white/70" />
            <h2 className="text-[13px] font-semibold tracking-wider text-white/90">
              LIBRARY
            </h2>
          </div>
          <button
            type="button"
            aria-label="close"
            className="h-8 w-8 grid place-items-center rounded-full text-white/60 hover:text-white hover:bg-white/10"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 px-4 pb-3">
          <div className="flex items-center gap-2 rounded-xl bg-white/8 px-3 py-2 ring-1 ring-white/10 focus-within:ring-white/20">
            <Search size={14} className="text-white/40" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索曲名或作者…"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-white/30"
            />
            {query && (
              <button
                type="button"
                aria-label="clear search"
                className="text-white/40 hover:text-white"
                onClick={() => setQuery("")}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Tabs — hidden while a search query is active (search is global). */}
        {!filtered && (
          <div className="shrink-0 px-4 pb-3">
            <div
              ref={tabContainerRef}
              onMouseLeave={() => setHoverRect(null)}
              className="relative flex gap-1 rounded-full bg-white/8 p-1 ring-1 ring-white/10"
            >
              {/* Floating hover indicator — slides between tabs with a spring. */}
              <motion.div
                aria-hidden
                className="pointer-events-none absolute top-1 bottom-1 rounded-full bg-black/20"
                style={{
                  boxShadow:
                    "0 2px 6px -3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.05)",
                }}
                initial={false}
                animate={{
                  x: hoverRect?.x ?? 0,
                  width: hoverRect?.w ?? 0,
                  opacity: hoverRect ? 1 : 0,
                }}
                transition={{
                  // Springy slide for x/width — "灵动" feel.
                  x: { type: "spring", stiffness: 420, damping: 28, mass: 0.55 },
                  width: { type: "spring", stiffness: 420, damping: 28, mass: 0.55 },
                  // Opacity fades quickly so the highlight feels "alive" rather
                  // than slowly materialising.
                  opacity: { duration: 0.14 },
                }}
              />
              <TabBtn
                idx={0}
                btnRef={(el) => (tabBtnRefs.current[0] = el)}
                onHover={onTabHover}
                active={tab === "favorites"}
                onClick={() => setTab("favorites")}
                icon={<Heart size={12} />}
              >
                收藏
              </TabBtn>
              <TabBtn
                idx={1}
                btnRef={(el) => (tabBtnRefs.current[1] = el)}
                onHover={onTabHover}
                active={tab === "history"}
                onClick={() => setTab("history")}
                icon={<HistoryIcon size={12} />}
              >
                最近
              </TabBtn>
              <TabBtn
                idx={2}
                btnRef={(el) => (tabBtnRefs.current[2] = el)}
                onHover={onTabHover}
                active={tab === "all"}
                onClick={() => setTab("all")}
                icon={<Music2 size={12} />}
              >
                全部
              </TabBtn>
            </div>
          </div>
        )}

        {/* Scrollable list */}
        <div className="custom-scroll relative flex-1 overflow-y-auto px-2 pb-6">
          <AnimatePresence mode="popLayout">
          <motion.div
            // Single key per visible view (search overrides tab). Changing the
            // key triggers exit + enter, giving us the same Gaussian-blur
            // condensation language used elsewhere.
            key={filtered ? "search" : tab}
            initial={listAnim.initial}
            animate={listAnim.animate}
            exit={listAnim.exit}
            transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }}
          >
          {filtered ? (
            <Section
              title={`搜索结果 (${filtered.length})`}
              icon={<Search size={12} />}
              empty="没有匹配的曲目"
            >
              {filtered.map((t) => (
                <Row
                  key={t.id}
                  track={t}
                  active={currentTrack?.id === t.id}
                  isPlaying={isPlaying && currentTrack?.id === t.id}
                  onClick={() => (currentTrack?.id === t.id ? togglePlay() : play(t.id))}
                />
              ))}
            </Section>
          ) : tab === "favorites" ? (
            <Section
              title={`收藏 (${favoriteTracks.length})`}
              icon={<Heart size={12} />}
              empty="还没有收藏的曲目"
            >
              {favoriteTracks.map((t) => (
                <Row
                  key={`fav-${t.id}`}
                  track={t}
                  active={currentTrack?.id === t.id}
                  isPlaying={isPlaying && currentTrack?.id === t.id}
                  onClick={() =>
                    currentTrack?.id === t.id ? togglePlay() : play(t.id)
                  }
                />
              ))}
            </Section>
          ) : tab === "history" ? (
            <Section
              title={`最近播放 (${historyTracks.length})`}
              icon={<HistoryIcon size={12} />}
              empty="还没有播放记录"
              trailing={
                historyTracks.length > 0 && (
                  <button
                    type="button"
                    onClick={clearHistory}
                    className="text-white/40 hover:text-rose-300 text-[10px] flex items-center gap-1"
                  >
                    <Trash2 size={11} /> 清空
                  </button>
                )
              }
            >
              {historyTracks.map(({ entry, track }) => (
                <Row
                  key={`h-${entry.playedAt}-${track.id}`}
                  track={track}
                  active={currentTrack?.id === track.id}
                  isPlaying={isPlaying && currentTrack?.id === track.id}
                  onClick={() =>
                    currentTrack?.id === track.id ? togglePlay() : play(track.id)
                  }
                  subtitle={timeAgo(entry.playedAt)}
                />
              ))}
            </Section>
          ) : (
            <Section title={`全部曲目 (${tracks.length})`} icon={<Music2 size={12} />}>
              {tracks.map((t) => (
                <Row
                  key={t.id}
                  track={t}
                  active={currentTrack?.id === t.id}
                  isPlaying={isPlaying && currentTrack?.id === t.id}
                  onClick={() =>
                    currentTrack?.id === t.id ? togglePlay() : play(t.id)
                  }
                />
              ))}
            </Section>
          )}
          </motion.div>
          </AnimatePresence>
        </div>
      </aside>

      {/* Pull-tab handle (visible when closed) */}
      <button
        type="button"
        aria-label="open library"
        onClick={() => (open ? onClose() : onOpen())}
        className="fixed top-1/2 right-0 z-[54] -translate-y-1/2 h-20 w-7 rounded-l-xl bg-white/8 hover:bg-white/15 backdrop-blur grid place-items-center text-white/60 hover:text-white transition-all"
        style={{
          transform: `translateY(-50%) translateX(${open ? "-360px" : "0px"})`,
          transition: "transform 300ms ease-out, background 200ms",
        }}
      >
        <ChevronRight size={14} className={open ? "" : "rotate-180"} />
      </button>

      <style jsx global>{`
        .custom-scroll::-webkit-scrollbar { width: 8px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.08);
          border-radius: 4px;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.15);
        }
      `}</style>
    </>
  )
}

function TabBtn({
  idx,
  active,
  onClick,
  onHover,
  btnRef,
  icon,
  children,
}: {
  idx: number
  active: boolean
  onClick: () => void
  onHover: (idx: number) => void
  btnRef: (el: HTMLButtonElement | null) => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      ref={btnRef}
      type="button"
      onClick={onClick}
      onMouseEnter={() => onHover(idx)}
      // z-10 keeps the label/icon visually above the absolutely-positioned
      // sliding indicator behind it.
      className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-[11px] font-medium tracking-wider uppercase transition-colors ${
        active ? "text-white" : "text-white/55"
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function Section({
  title,
  icon,
  children,
  empty,
  trailing,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  empty?: string
  trailing?: React.ReactNode
}) {
  const items = Array.isArray(children) ? children : [children]
  return (
    <div className="mb-4">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white/40">
          {icon}
          {title}
        </div>
        {trailing}
      </div>
      {items.length === 0 || (Array.isArray(children) && children.length === 0) ? (
        <div className="px-3 py-4 text-[12px] text-white/30 text-center">{empty}</div>
      ) : (
        <div className="space-y-0.5">{children}</div>
      )}
    </div>
  )
}

function Row({
  track,
  active,
  isPlaying,
  onClick,
  subtitle,
}: {
  track: Track
  active: boolean
  isPlaying: boolean
  onClick: () => void
  subtitle?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${
        active ? "bg-white/10" : "hover:bg-white/5"
      }`}
    >
      <div className="relative h-10 w-10 shrink-0 rounded-md overflow-hidden">
        <TrackCover track={track} sizes="40px" />
        {active && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            {isPlaying ? (
              <Pause size={14} className="text-white" />
            ) : (
              <Play size={14} className="text-white translate-x-[1px]" />
            )}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-[13px] ${active ? "text-white font-semibold" : "text-white/85"}`}
        >
          {track.title}
        </div>
        <div className="truncate text-[10px] text-white/45">
          {track.artist}
          {subtitle ? ` · ${subtitle}` : ""}
        </div>
      </div>
    </button>
  )
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const s = Math.floor(d / 1000)
  if (s < 60) return "刚刚"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const days = Math.floor(h / 24)
  return `${days} 天前`
}
