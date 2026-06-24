"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { X } from "lucide-react"
import { type Profile } from "@/lib/profiles"
import { fetchUserCardData, peekUserCardData, type UserCardStats } from "@/lib/user-card"
import { UserCardBody } from "@/components/user-hover-card"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import { followUser, unfollowUser, isFollowing as checkIsFollowing } from "@/lib/follows"

// 聊天点头像弹出的「精简社交卡片」。
// 卡面与首页 hover 卡完全复用（UserCardBody + .glass-user-card 毛玻璃壳），
// 这里只负责：居中浮层 + 遮罩 + 关闭交互 + 数据加载 + 主按钮（私信 / 关注）。
export interface ChatUserCardTarget {
  id: string
  username: string
  avatar_url?: string | null
}

export interface ChatUserCardProps {
  target: ChatUserCardTarget
  // 主按钮模式：
  //   "dm"     大厅点别人头像 → 「私信」(发起私聊，走 onDm)
  //   "follow" 私聊页点对方头像 → 「关注/已关注」(已在私聊、私信冗余，走内置关注逻辑)
  mode?: "dm" | "follow"
  onClose: () => void
  onDm: () => void
  onGoProfile: () => void
}

export default function ChatUserCard({ target, mode = "dm", onClose, onDm, onGoProfile }: ChatUserCardProps) {
  const { user } = useSimpleAuth()
  const { toast } = useToast()

  // 先用聊天里已知的头像/名字占位，背景图/签名/统计异步补齐（零延迟开卡）。
  // 数据走 lib/user-card 的模块级缓存：60s 内看过这个人（hover 卡/聊天卡）直接秒填。
  const [profile, setProfile] = useState<Profile | null>(
    () => peekUserCardData(target.id, { allowStale: true })?.profile ?? null,
  )
  const [stats, setStats] = useState<UserCardStats | null>(
    () => peekUserCardData(target.id, { allowStale: true })?.stats ?? null,
  )

  // 关注态（仅 follow 模式用）：开卡时查一次「我是否已关注 Ta」+ 请求中标记。
  const [following, setFollowing] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)

  const isFollowMode = mode === "follow"
  const isSelf = !!user && user.id === target.id
  const myName =
    user?.user_metadata?.username ||
    user?.user_metadata?.displayName ||
    (user?.email ? user.email.split("@")[0] : undefined)

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

  // follow 模式：查询当前关注态（仅登录且非自己）
  useEffect(() => {
    if (!isFollowMode || !user || isSelf) return
    let alive = true
    void checkIsFollowing(user.id, target.id).then((f) => {
      if (alive) setFollowing(f)
    })
    return () => {
      alive = false
    }
  }, [isFollowMode, user, isSelf, target.id])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  // 关注 / 取关：乐观更新关注态 + 卡面粉丝数，失败回滚。逻辑与首页 hover 卡一致。
  const handleFollow = async () => {
    if (!user) {
      toast({ title: "请先登录", description: "登录后才能关注", variant: "destructive" })
      return
    }
    // 自己：主按钮充当「我的主页」入口（私聊场景几乎不会点到自己，留作兜底）
    if (isSelf) {
      onGoProfile()
      return
    }
    if (followBusy) return
    const prev = following
    setFollowing(!prev)
    setStats((s) => (s ? { ...s, followers: Math.max(0, s.followers + (prev ? -1 : 1)) } : s))
    setFollowBusy(true)
    try {
      if (prev) await unfollowUser(user.id, target.id)
      else await followUser(user.id, target.id, myName)
    } catch (err) {
      // 回滚
      setFollowing(prev)
      setStats((s) => (s ? { ...s, followers: Math.max(0, s.followers + (prev ? 1 : -1)) } : s))
      const e = err as { message?: string }
      toast({ title: "操作失败", description: e?.message || "请稍后再试", variant: "destructive" })
    } finally {
      setFollowBusy(false)
    }
  }

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
          primaryLabel={
            isFollowMode ? (isSelf ? "我的主页" : following ? "已关注" : "关注") : "私信"
          }
          primaryActive={isFollowMode && !isSelf && following}
          primaryDisabled={isFollowMode && followBusy}
          onPrimary={isFollowMode ? handleFollow : onDm}
          onSecondary={onGoProfile}
        />
      </motion.div>
    </div>,
    document.body,
  )
}
