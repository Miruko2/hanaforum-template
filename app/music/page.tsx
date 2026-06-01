"use client"

import dynamic from "next/dynamic"
import { useCallback, useState } from "react"
import { PlaybackProvider } from "./_context/PlaybackContext"
import type { Track } from "./_data/tracks"
import type { ExpandRect, ExpandTarget } from "./_components/ExpandedCard"

const MusicCanvas = dynamic(
  () => import("./_components/MusicCanvas").then((m) => m.MusicCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[100dvh] grid place-items-center bg-black text-white/50 text-sm">
        Loading…
      </div>
    ),
  },
)

const MusicPlayer = dynamic(
  () => import("./_components/MusicPlayer").then((m) => m.MusicPlayer),
  { ssr: false },
)

const HistoryPanel = dynamic(
  () => import("./_components/HistoryPanel").then((m) => m.HistoryPanel),
  { ssr: false },
)

const ExpandedCard = dynamic(
  () => import("./_components/ExpandedCard").then((m) => m.ExpandedCard),
  { ssr: false },
)

export default function MusicPage() {
  const [libraryOpen, setLibraryOpen] = useState(false)
  // Expanded "now playing" overlay — shared between the canvas (card click)
  // and the bottom player (click anywhere on its panel).
  const [expand, setExpand] = useState<ExpandTarget>(null)
  const handleExpand = useCallback((track: Track, rect: ExpandRect) => {
    setExpand((cur) =>
      cur && cur.track.id === track.id
        ? null
        : {
            track,
            rect: {
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
            },
          },
    )
  }, [])

  // 当任一覆盖层（HistoryPanel 抽屉 / ExpandedCard 弹窗）打开时为 true。
  // 仅 Android Chrome 上 MusicCanvas 会据此退出渲染，规避 preserve-3d 元素
  // 逃出 stacking context、渲染在覆盖层上面导致的"鬼影"花屏。
  const overlayOpen = libraryOpen || expand !== null

  return (
    <PlaybackProvider>
      <MusicCanvas onExpand={handleExpand} overlayOpen={overlayOpen} />
      <MusicPlayer
        onToggleHistory={() => setLibraryOpen((v) => !v)}
        onExpand={handleExpand}
      />
      <HistoryPanel
        open={libraryOpen}
        onOpen={() => setLibraryOpen(true)}
        onClose={() => setLibraryOpen(false)}
      />
      <ExpandedCard target={expand} onClose={() => setExpand(null)} />
    </PlaybackProvider>
  )
}
