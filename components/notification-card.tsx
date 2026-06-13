"use client"

import { Heart, MessageCircle, Reply, ShieldAlert, Megaphone, UserPlus, Loader2 } from "lucide-react"
import { cdnUrl } from "@/lib/cdn-url"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { formatDate, cn } from "@/lib/utils"
import type { Notification } from "@/lib/types"

/**
 * 通知类型对应的图标和颜色角标
 */
const TYPE_META: Record<
  Notification["type"],
  { icon: typeof Heart; color: string; bg: string }
> = {
  like_post: {
    icon: Heart,
    color: "text-pink-400",
    bg: "bg-pink-500/15 border-pink-500/25",
  },
  comment_post: {
    icon: MessageCircle,
    color: "text-lime-400",
    bg: "bg-lime-500/15 border-lime-500/25",
  },
  like_comment: {
    icon: Reply,
    color: "text-violet-400",
    bg: "bg-violet-500/15 border-violet-500/25",
  },
  // 内容被审核移除（系统通知，无触发者）
  post_removed: {
    icon: ShieldAlert,
    color: "text-amber-400",
    bg: "bg-amber-500/15 border-amber-500/25",
  },
  // 全员公告（系统通知，头像用站点 logo）
  announcement: {
    icon: Megaphone,
    color: "text-lime-400",
    bg: "bg-lime-500/15 border-lime-500/25",
  },
  // 被关注
  follow: {
    icon: UserPlus,
    color: "text-sky-400",
    bg: "bg-sky-500/15 border-sky-500/25",
  },
}

interface NotificationCardProps {
  notification: Notification
  isLoadingThis?: boolean
  onClick: () => void
  /** 紧凑模式（铃铛弹窗里用），padding 更小 */
  compact?: boolean
}

/**
 * 通知卡片：毛玻璃 + hover 上浮 + 未读 lime 竖条。
 * 在 /notifications 页和导航栏铃铛弹窗里都会用。
 */
export default function NotificationCard({
  notification,
  isLoadingThis = false,
  onClick,
  compact = false,
}: NotificationCardProps) {
  // 公告类通知：发件人显示为系统、头像用站点 logo
  const isAnnouncement = notification.type === "announcement"
  const username = isAnnouncement
    ? "系统公告"
    : notification.actor?.username || "匿名用户"
  const avatarUrl = isAnnouncement ? "/logo.png" : notification.actor?.avatar_url
  const message = notification.message || "新通知"
  const createdAt = notification.created_at || new Date().toISOString()
  const isRead = notification.is_read ?? false

  const meta = TYPE_META[notification.type] ?? TYPE_META.like_post
  const Icon = meta.icon

  const quote =
    notification.comment?.content || notification.post?.title || null

  const getInitial = (u?: string) => (u ? u.charAt(0).toUpperCase() : "?")

  return (
    <button
      onClick={onClick}
      disabled={isLoadingThis}
      className={cn(
        "notification-card w-full text-left relative rounded-2xl overflow-hidden transition-all duration-300",
        // 注意：父级面板通常已经做了 backdrop-blur（铃铛弹窗和 /notifications 页都在毛玻璃容器里），
        // 所以这里不再叠 backdrop-blur，直接用更明亮的半透明白底提高可读性
        "border border-white/15 bg-white/[0.08]",
        "hover:bg-white/[0.14] hover:border-white/25 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30",
        isLoadingThis && "opacity-60 pointer-events-none",
      )}
    >
      {/* 未读状态：左侧 lime 色竖条 */}
      {!isRead && (
        <div
          className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-lime-400"
          style={{ boxShadow: "0 0 12px rgba(132,204,22,0.6)" }}
        />
      )}

      <div
        className={cn(
          "flex items-start gap-3 pl-5",
          compact ? "p-3" : "p-4",
        )}
      >
        {/* 头像 + 类型角标 */}
        <div className="relative shrink-0">
          <Avatar
            className={cn(
              "border border-white/15",
              compact ? "h-9 w-9" : "h-10 w-10",
            )}
          >
            <AvatarImage src={cdnUrl(avatarUrl) || "/placeholder.svg"} />
            <AvatarFallback className="bg-black/40 text-white/80 text-sm">
              {getInitial(username)}
            </AvatarFallback>
          </Avatar>
          <div
            className={cn(
              "absolute -bottom-1 -right-1 h-5 w-5 rounded-full flex items-center justify-center border backdrop-blur-md",
              meta.bg,
            )}
          >
            <Icon className={cn("h-3 w-3", meta.color)} />
          </div>
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0 space-y-1">
          <p
            className={cn(
              "leading-tight text-sm",
              isRead ? "text-white/70" : "text-white",
            )}
          >
            {message}
          </p>

          {quote && (
            <p className="text-xs text-white/40 pl-2 border-l border-white/15 line-clamp-2">
              "{quote}"
            </p>
          )}

          <div className="flex items-center justify-between text-xs text-white/40 pt-0.5">
            <span>{formatDate(createdAt)}</span>
            {isLoadingThis && (
              <span className="flex items-center gap-1 text-lime-400">
                <Loader2 className="h-3 w-3 animate-spin" />
                打开中...
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
