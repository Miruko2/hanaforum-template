"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { UserPlus, UserCheck, MessageCircle } from "lucide-react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useChatUI } from "@/contexts/chat-ui-context"
import { useToast } from "@/hooks/use-toast"
import {
  followUser,
  unfollowUser,
  isFollowing as checkIsFollowing,
  getFollowCounts,
} from "@/lib/follows"

// 社交个人页操作区（关注 / 取关 + 私聊 + 粉丝/关注计数）。放进 ProfileHeader 的 actions 插槽。
//   · 未登录：点关注/私聊 → 提示去登录。
//   · 看自己的页：不渲染（自己页走 /profile 编辑，不需要关注自己）。
export interface ProfileActionsProps {
  targetId: string
  targetName: string
  targetAvatar: string | null
}

export default function ProfileActions({ targetId, targetName, targetAvatar }: ProfileActionsProps) {
  const { user } = useSimpleAuth()
  const { startDmWith } = useChatUI()
  const { toast } = useToast()
  const router = useRouter()

  const [following, setFollowing] = useState(false)
  const [counts, setCounts] = useState({ followers: 0, following: 0 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const isSelf = !!user && user.id === targetId

  // 初次加载：关注态 + 粉丝/关注计数
  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      const [cnts, fol] = await Promise.all([
        getFollowCounts(targetId),
        user && !isSelf ? checkIsFollowing(user.id, targetId) : Promise.resolve(false),
      ])
      if (!alive) return
      setCounts(cnts)
      setFollowing(fol)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [targetId, user, isSelf])

  const myName =
    user?.user_metadata?.username ||
    user?.user_metadata?.displayName ||
    (user?.email ? user.email.split("@")[0] : undefined)

  const handleToggleFollow = async () => {
    if (!user) {
      toast({ title: "请先登录", description: "登录后才能关注", variant: "destructive" })
      return
    }
    if (isSelf || busy) return
    const prev = following
    const prevFollowers = counts.followers
    // 乐观更新
    setFollowing(!prev)
    setCounts((c) => ({ ...c, followers: c.followers + (prev ? -1 : 1) }))
    setBusy(true)
    try {
      if (prev) await unfollowUser(user.id, targetId)
      else await followUser(user.id, targetId, myName)
    } catch (err) {
      // 回滚
      setFollowing(prev)
      setCounts((c) => ({ ...c, followers: prevFollowers }))
      const e = err as { message?: string }
      toast({ title: "操作失败", description: e?.message || "请稍后再试", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const handleDm = () => {
    if (!user) {
      toast({ title: "请先登录", description: "登录后才能私聊", variant: "destructive" })
      return
    }
    if (isSelf) return
    startDmWith({ id: targetId, username: targetName, avatar_url: targetAvatar })
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* 粉丝 / 关注计数 */}
      <div className="flex items-center gap-4 text-sm text-white/70">
        <span>
          <span className="font-semibold text-white tabular-nums">{counts.followers}</span> 粉丝
        </span>
        <span>
          <span className="font-semibold text-white tabular-nums">{counts.following}</span> 关注
        </span>
      </div>

      {/* 自己的页不显示关注/私聊；改为「编辑资料」入口 */}
      {isSelf ? (
        <button
          onClick={() => router.push("/profile")}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
        >
          编辑资料
        </button>
      ) : (
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleToggleFollow}
            disabled={loading || busy}
            className={
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 " +
              (following
                ? "border border-white/15 bg-white/5 text-white/80 hover:bg-white/10"
                : "bg-lime-500 text-black hover:bg-lime-400")
            }
          >
            {following ? (
              <>
                <UserCheck className="h-4 w-4" />
                已关注
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" />
                关注
              </>
            )}
          </button>
          <button
            onClick={handleDm}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white/80 transition-colors hover:bg-white/10"
          >
            <MessageCircle className="h-4 w-4" />
            私聊
          </button>
        </div>
      )}
    </div>
  )
}
