"use client"

import { useTrackSource } from "../_context/PlaybackContext"

/**
 * 「我的 / 精选」切换。仅当「我的」非空（本地上传歌 + 链接歌任一存在）时出现。
 * 磨砂玻璃分段控件，与音乐页整体毛玻璃语言一致。
 */
export function SourceToggle() {
  const { source, setSource, hasMine } = useTrackSource()
  if (!hasMine) return null
  return (
    <div
      className="flex items-center gap-0.5 rounded-full p-0.5 text-[12px]"
      style={{
        background: "rgba(255,255,255,0.08)",
        backdropFilter: "blur(20px) saturate(140%)",
        WebkitBackdropFilter: "blur(20px) saturate(140%)",
        boxShadow:
          "0 8px 24px -8px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.12)",
      }}
    >
      <Seg active={source === "mine"} onClick={() => setSource("mine")}>
        我的
      </Seg>
      <Seg active={source === "featured"} onClick={() => setSource("featured")}>
        精选
      </Seg>
    </div>
  )
}

function Seg({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 font-medium transition-colors ${
        active ? "bg-white text-black" : "text-white/70 hover:text-white"
      }`}
    >
      {children}
    </button>
  )
}
