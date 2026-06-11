"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { X, MessageCircle, ExternalLink } from "lucide-react"
import { getPublicProfile } from "@/lib/profiles"

// 聊天大厅点头像弹出的「精简社交卡片」。
// 视觉照搬社交主页的资料卡(ProfileHeader)，精简到：背景图 + 头像 + 用户名 + 签名，
// 底部两个动作：私聊 / 进入主页。居中浮层 + 点遮罩关闭。
export interface ChatUserCardTarget {
  id: string
  username: string
  avatar_url?: string | null
}

export interface ChatUserCardProps {
  target: ChatUserCardTarget
  onClose: () => void
  onDm: () => void
  onGoProfile: () => void
}

export default function ChatUserCard({ target, onClose, onDm, onGoProfile }: ChatUserCardProps) {
  // 先用聊天里已知的头像/名字占位，背景图与签名异步补齐（零延迟开卡）
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)
  const [bio, setBio] = useState<string>("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(target.avatar_url ?? null)
  const [username, setUsername] = useState<string>(target.username)
  // 背景图加载完成才淡入，避免「基底 → 图」硬跳
  const [bgLoaded, setBgLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    setBgLoaded(false)
    getPublicProfile(target.id).then((p) => {
      if (!alive || !p) return
      setBackgroundUrl(p.background_url)
      setBio(p.bio || "")
      if (p.avatar_url) setAvatarUrl(p.avatar_url)
      if (p.username) setUsername(p.username)
    })
    return () => {
      alive = false
    }
  }, [target.id])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const fallbackLetter = username?.[0]?.toUpperCase() || "U"

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onClick={onClose}
      >
        <motion.div
          className="relative w-full max-w-[300px] overflow-hidden rounded-2xl border border-white/15 shadow-[0_24px_70px_rgba(0,0,0,0.6)]"
          initial={{ opacity: 0, scale: 0.92, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 12 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── 卡片底：始终是中性深色玻璃基底；背景图(放大+模糊)加载完再淡入叠上。 ── */}
          <div className="absolute inset-0 -z-10 bg-neutral-900">
            {/* 基底纹理：低调的径向高光，避免纯黑死板（无背景图时也好看） */}
            <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,rgba(120,130,150,0.18),transparent_60%)]" />
            {backgroundUrl && (
              <img
                src={backgroundUrl}
                alt=""
                aria-hidden
                onLoad={() => setBgLoaded(true)}
                className={
                  "absolute inset-0 h-full w-full scale-150 object-cover blur-2xl transition-opacity duration-500 " +
                  (bgLoaded ? "opacity-100" : "opacity-0")
                }
              />
            )}
            {/* 毛玻璃压暗层：保证文字/按钮可读，同时维持「玻璃」观感 */}
            <div className="absolute inset-0 bg-neutral-900/45 backdrop-blur-xl" />
          </div>

          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            aria-label="关闭"
            className="absolute right-2 top-2 z-10 rounded-full bg-black/40 p-1.5 text-white/80 transition-colors hover:bg-black/60 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>

          {/* 背景图 Banner（清晰原图，作为头部横幅；与卡底模糊版形成层次） */}
          <div className="relative h-24 w-full overflow-hidden">
            {backgroundUrl && (
              <img
                src={backgroundUrl}
                alt="背景图"
                className={
                  "h-full w-full object-cover transition-opacity duration-500 " +
                  (bgLoaded ? "opacity-100" : "opacity-0")
                }
              />
            )}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-neutral-900/60 via-transparent to-transparent" />
          </div>

          {/* 头像 + 资料 */}
          <div className="px-5 pb-5">
            <div className="relative -mt-10 mb-2 inline-block">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-[3px] border-white/20 bg-lime-900/40 shadow-lg">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="头像" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-2xl font-bold text-lime-400">{fallbackLetter}</span>
                )}
              </div>
            </div>

            <h3 className="truncate text-lg font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
              {username || "用户"}
            </h3>
            {bio ? (
              <p className="mt-1.5 line-clamp-3 whitespace-pre-line text-sm leading-relaxed text-white/75 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
                {bio}
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-white/40">这个人很神秘，什么也没留下</p>
            )}

            {/* 动作 */}
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={onDm}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-lime-500 px-3 py-2 text-sm font-medium text-black transition-colors hover:bg-lime-400"
              >
                <MessageCircle className="h-4 w-4" />
                私聊
              </button>
              <button
                onClick={onGoProfile}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white/90 backdrop-blur-md transition-colors hover:bg-white/20"
              >
                <ExternalLink className="h-4 w-4" />
                进入主页
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}
