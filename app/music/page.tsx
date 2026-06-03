"use client"

import dynamic from "next/dynamic"
import { useCallback, useState } from "react"
import { ListMusic } from "lucide-react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
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

const MusicLibraryEditor = dynamic(
  () => import("./_components/MusicLibraryEditor").then((m) => m.MusicLibraryEditor),
  { ssr: false },
)

const SourceToggle = dynamic(
  () => import("./_components/SourceToggle").then((m) => m.SourceToggle),
  { ssr: false },
)

export default function MusicPage() {
  const { user } = useSimpleAuth()
  const [editorOpen, setEditorOpen] = useState(false)
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
  const overlayOpen = libraryOpen || expand !== null || editorOpen

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

      {/* 左上角控件区：「我的音乐」入口（登录可见）+「我的/精选」切换（有自定义曲目时出现） */}
      <div className="fixed top-4 left-4 z-[60] flex items-center gap-2">
        {user && (
          <button
            type="button"
            aria-label="我的音乐"
            onClick={() => setEditorOpen(true)}
            className="flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12px] text-white/80 backdrop-blur transition-colors hover:bg-white/20 hover:text-white"
          >
            <ListMusic size={14} />
            我的音乐
          </button>
        )}
        <SourceToggle />
      </div>
      <MusicLibraryEditor open={editorOpen} onClose={() => setEditorOpen(false)} />
    </PlaybackProvider>
  )
}
