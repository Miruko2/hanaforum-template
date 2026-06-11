"use client"

import { useState, cloneElement, isValidElement, type ReactElement, type MouseEvent } from "react"
import { useRouter } from "next/navigation"
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useChatUI } from "@/contexts/chat-ui-context"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import { getPublicProfile, type Profile } from "@/lib/profiles"
import { getUserCardStats, type UserCardStats } from "@/lib/user-card"

interface UserHoverCardProps {
  userId: string
  // 触发区域已知的展示信息（来自帖子数据），用于卡片首屏即时显示、避免空白
  fallbackName: string
  fallbackAvatar: string | null
  children: React.ReactNode
}

// 单条统计：数字在上、标签在下，居中。参考设计的三栏布局。
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-lg font-bold leading-none text-white tabular-nums">{value}</span>
      <span className="mt-1 text-xs text-white/50">{label}</span>
    </div>
  )
}

export interface UserCardBodyProps {
  username: string
  avatarUrl: string | null
  backgroundUrl: string | null
  bio: string | null
  stats: UserCardStats | null
  primaryLabel?: string
  secondaryLabel?: string
  onPrimary: () => void
  onSecondary: () => void
}

// 卡面内容（banner + 头像 + 用户名/签名 + 三栏统计 + 两个动作按钮）。
// 首页 hover 卡和聊天窗口的居中卡共用这一张卡面，外壳(.glass-user-card)由调用方提供。
export function UserCardBody({
  username,
  avatarUrl,
  backgroundUrl,
  bio,
  stats,
  primaryLabel = "私信",
  secondaryLabel = "查看主页",
  onPrimary,
  onSecondary,
}: UserCardBodyProps) {
  return (
    <>
      {/* 背景图 Banner：底部经 mask 渐隐，直接融进毛玻璃（样式见 globals.css） */}
      <div className="user-card-banner relative h-24 w-full">
        {backgroundUrl ? (
          <img src={backgroundUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-lime-400/20 via-emerald-500/10 to-transparent" />
        )}
      </div>

      <div className="px-4 pb-4">
        {/* 头像：叠在 banner 下沿 */}
        <div className="relative -mt-9 mb-2 inline-block">
          <img
            src={avatarUrl || "/logo.png"}
            alt={username}
            className="h-16 w-16 rounded-full border-[3px] border-white/25 object-cover shadow-[0_8px_24px_rgba(0,0,0,0.45)]"
            onError={(e) => {
              const img = e.currentTarget
              if (img.src.indexOf("/logo.png") === -1) img.src = "/logo.png"
            }}
          />
        </div>

        {/* 用户名 + 签名 */}
        <h3 className="truncate text-xl font-bold leading-tight">{username}</h3>
        <p className="mt-1 line-clamp-2 min-h-[1.25rem] text-sm text-white/50">
          {bio || "这个人很神秘，什么都没留下"}
        </p>

        {/* 三栏统计 */}
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4">
          <Stat value={stats?.likes ?? 0} label="获赞" />
          <Stat value={stats?.followers ?? 0} label="粉丝" />
          <Stat value={stats?.posts ?? 0} label="帖子" />
        </div>

        {/* 操作按钮 */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onPrimary}
            className="flex-1 rounded-xl bg-lime-400 py-2.5 text-sm font-semibold text-black shadow-[0_4px_18px_rgba(163,230,53,0.25)] transition-all hover:bg-lime-300 hover:shadow-[0_4px_24px_rgba(163,230,53,0.4)]"
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            onClick={onSecondary}
            className="flex-1 rounded-xl border border-white/10 bg-white/10 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15"
          >
            {secondaryLabel}
          </button>
        </div>
      </div>
    </>
  )
}

// 头像 hover 弹出的精简社交卡片：背景图 + 头像(带等级角标) + 用户名 + 签名 +
// 三栏统计(获赞/粉丝/帖子) + 私信 / 查看主页。数据在首次 hover 时懒加载。
export default function UserHoverCard({
  userId,
  fallbackName,
  fallbackAvatar,
  children,
}: UserHoverCardProps) {
  const router = useRouter()
  const { user } = useSimpleAuth()
  const { startDmWith } = useChatUI()
  const { toast } = useToast()
  const isMobile = useIsMobile()

  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState<UserCardStats | null>(null)
  const [loaded, setLoaded] = useState(false)
  // 受控开关：手机/平板用点击触发(touch 无 hover)，桌面仍用 hover
  const [open, setOpen] = useState(false)

  const isSelf = !!user && user.id === userId
  const username = profile?.username || fallbackName
  const avatarUrl = profile?.avatar_url || fallbackAvatar

  // 首次打开拉数据，之后复用缓存
  const loadOnce = () => {
    if (loaded) return
    setLoaded(true)
    void Promise.all([getPublicProfile(userId), getUserCardStats(userId)]).then(
      ([p, s]) => {
        if (p) setProfile(p)
        setStats(s)
      }
    )
  }

  const handleOpenChange = (next: boolean) => {
    // 触摸设备屏蔽 hover 引发的开合，完全交给点击控制
    if (isMobile) return
    if (next) loadOnce()
    setOpen(next)
  }

  // 移动端点击头像：切换卡片显隐
  const handleTriggerClick = (e: MouseEvent) => {
    e.stopPropagation()
    if (!isMobile) return
    if (!open) loadOnce()
    setOpen((o) => !o)
  }

  // 把点击处理合并进子元素自身的 onClick，避免额外包一层 <span> 破坏头像的叠放布局
  const triggerChild = isValidElement(children)
    ? cloneElement(children as ReactElement<{ onClick?: (e: MouseEvent) => void }>, {
        onClick: (e: MouseEvent) => {
          ;(children as ReactElement<{ onClick?: (e: MouseEvent) => void }>).props.onClick?.(e)
          handleTriggerClick(e)
        },
      })
    : children

  const goProfile = () => {
    setOpen(false)
    router.push(`/user?id=${userId}`)
  }

  const handleDm = () => {
    if (!user) {
      toast({ title: "请先登录", description: "登录后才能私信", variant: "destructive" })
      return
    }
    setOpen(false)
    if (isSelf) {
      router.push(`/user?id=${userId}`)
      return
    }
    startDmWith({ id: userId, username, avatar_url: avatarUrl })
  }

  return (
    <HoverCard open={open} openDelay={200} closeDelay={120} onOpenChange={handleOpenChange}>
      <HoverCardTrigger asChild>{triggerChild}</HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        sideOffset={10}
        className="glass-user-card w-72 overflow-hidden rounded-2xl p-0 text-white"
        onClick={(e) => e.stopPropagation()}
        onInteractOutside={() => setOpen(false)}
      >
        <UserCardBody
          username={username}
          avatarUrl={avatarUrl}
          backgroundUrl={profile?.background_url ?? null}
          bio={profile?.bio ?? null}
          stats={stats}
          primaryLabel={isSelf ? "我的主页" : "私信"}
          onPrimary={handleDm}
          onSecondary={goProfile}
        />
      </HoverCardContent>
    </HoverCard>
  )
}
