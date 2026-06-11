"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { X } from "lucide-react"
import { type Profile } from "@/lib/profiles"
import { fetchUserCardData, peekUserCardData, type UserCardStats } from "@/lib/user-card"
import { UserCardBody } from "@/components/user-hover-card"

// 聊天大厅点头像弹出的「精简社交卡片」。
// 卡面与首页 hover 卡完全复用（UserCardBody + .glass-user-card 毛玻璃壳），
// 这里只负责：居中浮层 + 遮罩 + 关闭交互 + 数据加载。
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
  // 先用聊天里已知的头像/名字占位，背景图/签名/统计异步补齐（零延迟开卡）。
  // 数据走 lib/user-card 的模块级缓存：60s 内看过这个人（hover 卡/聊天卡）直接秒填。
  const [profile, setProfile] = useState<Profile | null>(
    () => peekUserCardData(target.id, { allowStale: true })?.profile ?? null,
  )
  const [stats, setStats] = useState<UserCardStats | null>(
    () => peekUserCardData(target.id, { allowStale: true })?.stats ?? null,
  )

  useEffect(() => {
    let alive = true
    void fetchUserCardData(target.id).then((d) => {
      if (!alive) return
      if (d.profile) setProfile(d.profile)
      setStats(d.stats)
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

  const username = profile?.username || target.username || "用户"
  const avatarUrl = profile?.avatar_url || target.avatar_url || null

  return createPortal(
    // 外层容器不做 opacity 动画；遮罩与卡片是兄弟层，
    // 避免祖先 opacity<1 期间废掉卡片自身的 backdrop-filter（毛玻璃闪跳）。
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        className="absolute inset-0 bg-black/60"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
      />
      <motion.div
        className="glass-user-card relative w-72 overflow-hidden rounded-2xl text-white"
        initial={{ opacity: 0, scale: 0.92, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-2 top-2 z-10 rounded-full bg-black/40 p-1.5 text-white/80 transition-colors hover:bg-black/60 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <UserCardBody
          username={username}
          avatarUrl={avatarUrl}
          backgroundUrl={profile?.background_url ?? null}
          bio={profile?.bio ?? null}
          stats={stats}
          onPrimary={onDm}
          onSecondary={onGoProfile}
        />
      </motion.div>
    </div>,
    document.body,
  )
}
