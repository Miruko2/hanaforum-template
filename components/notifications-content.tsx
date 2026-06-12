"use client"

import { useEffect, useState, useCallback } from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useNotifications } from "@/contexts/notification-context"
import { Button } from "@/components/ui/button"
import { Loader2, MailX } from "lucide-react"
import { navigateTo } from "@/lib/app-navigation"
import { useRouter } from "next/navigation"
import type { Notification, Post } from "@/lib/types"
import Container from "@/components/container"
import PostDetailModal from "@/components/post-detail-modal"
import NotificationCard from "@/components/notification-card"
import AnnouncementModal from "@/components/announcement-modal"
import { getPost, likePost, unlikePost, checkUserLiked, getAnnouncement } from "@/lib/supabase"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"

/**
 * 通知类型对应的图标和颜色
 * 注：这里的颜色只用于通知图标角标，不影响整体毛玻璃风格
 */

export default function NotificationsContent() {
  const { user, isAdmin } = useSimpleAuth()
  const { notifications, unreadCount, isLoading, markAsRead, markAllAsRead } = useNotifications()
  const { toast } = useToast()
  const isMobile = useIsMobile()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  // 帖子详情模态框状态
  const [activePost, setActivePost] = useState<Post | null>(null)
  const [loadingPostId, setLoadingPostId] = useState<string | null>(null)
  // 公告弹窗状态
  const [activeAnnouncement, setActiveAnnouncement] = useState<
    { title: string; content: string; created_at: string } | null
  >(null)
  const [modalLiked, setModalLiked] = useState(false)
  const [modalLikeCount, setModalLikeCount] = useState(0)
  const [modalIsLiking, setModalIsLiking] = useState(false)

  // 未登录时重定向到首页
  useEffect(() => {
    if (!user) {
      navigateTo("/")
    }
  }, [user])

  // 点击通知：标记已读 + 尝试获取帖子并打开详情
  const handleNotificationClick = useCallback(
    async (notification: Notification) => {
      try {
        // 先立即标记已读（乐观更新）
        if (!notification.is_read) {
          markAsRead(notification.id)
        }

        // 公告类通知：打开公告弹窗
        if (notification.type === "announcement") {
          if (!notification.announcement_id) return
          setLoadingPostId(notification.id)
          try {
            const ann = await getAnnouncement(notification.announcement_id)
            if (ann) {
              setActiveAnnouncement(ann)
            } else {
              toast({
                title: "公告不存在",
                description: "该公告可能已被删除",
                variant: "destructive",
              })
            }
          } finally {
            setLoadingPostId(null)
          }
          return
        }

        if (!notification.post_id) {
          // follow 类型：跳到关注者(actor)的社交主页
          if (notification.type === "follow" && notification.actor_id) {
            router.push(`/user?id=${notification.actor_id}`)
            return
          }
          // 没帖子可跳，只做标记已读
          return
        }

        setLoadingPostId(notification.id)

        const post = await getPost(notification.post_id)

        // 检查该用户对这个帖子的点赞状态
        let userLiked = false
        if (user) {
          try {
            userLiked = !!(await checkUserLiked(post.id, user.id))
          } catch {
            // 点赞状态不是致命错误，忽略
          }
        }

        setActivePost(post as Post)
        setModalLiked(userLiked)
        setModalLikeCount((post as Post).likes_count ?? 0)
      } catch (err: any) {
        console.error("打开帖子详情失败:", err)
        // 帖子可能已被删除
        if (err?.message?.includes("不存在") || err?.code === "PGRST116") {
          toast({
            title: "帖子已被删除",
            description: "该通知对应的帖子不存在",
            variant: "destructive",
          })
          // 也把这条通知标记为已读，避免下次再点还报错
          if (!notification.is_read) {
            markAsRead(notification.id)
          }
        } else {
          toast({
            title: "加载失败",
            description: "暂时无法加载帖子详情，请稍后重试",
            variant: "destructive",
          })
        }
      } finally {
        setLoadingPostId(null)
      }
    },
    [markAsRead, user, toast, router],
  )

  // 模态框里的点赞交互（沿用首页 PostCard 的乐观更新套路）
  const handleModalLike = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!user || !activePost || modalIsLiking) return

      try {
        setModalIsLiking(true)
        const newLiked = !modalLiked
        const newCount = newLiked ? modalLikeCount + 1 : modalLikeCount - 1
        setModalLiked(newLiked)
        setModalLikeCount(newCount)

        if (newLiked) {
          await likePost(activePost.id, user.id)
        } else {
          await unlikePost(activePost.id, user.id)
        }
      } catch {
        // 回滚
        setModalLiked(modalLiked)
        setModalLikeCount(modalLikeCount)
      } finally {
        setModalIsLiking(false)
      }
    },
    [user, activePost, modalIsLiking, modalLiked, modalLikeCount],
  )

  const handleModalClose = useCallback(() => {
    setActivePost(null)
  }, [])

  if (!user) return null

  return (
    <Container>
      <div className="py-6">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div
              className="h-8 w-1 bg-lime-400 rounded-full"
              style={{ boxShadow: "0 0 16px rgba(132,204,22,0.5)" }}
            />
            <h1 className="text-2xl font-bold text-white">我的通知</h1>
            {unreadCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-lime-400/20 text-lime-400 border border-lime-400/30">
                {unreadCount} 条未读
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              className="text-lime-400 border-lime-400/30 bg-white/[0.03] hover:bg-lime-400/10 backdrop-blur-md"
              onClick={() => {
                try {
                  markAllAsRead()
                } catch (err) {
                  console.error("标记已读失败:", err)
                  setError("标记全部已读失败")
                }
              }}
            >
              全部标记为已读
            </Button>
          )}
        </div>

        {error && (
          <div className="text-center py-4 text-red-400 mb-4">
            <p>{error}</p>
          </div>
        )}

        {/* 毛玻璃面板：和铃铛弹窗结构对等，把通知卡片托在这块玻璃上 */}
        <div
          className="rounded-2xl border border-white/15 shadow-2xl p-4 space-y-3"
          style={{
            background: "rgba(20, 20, 28, 0.55)",
            backdropFilter: "blur(24px) saturate(150%)",
            WebkitBackdropFilter: "blur(24px) saturate(150%)",
          }}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-lime-400" />
              <span className="ml-2 text-white/60">加载中...</span>
            </div>
          ) : notifications && notifications.length > 0 ? (
            notifications.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                isLoadingThis={loadingPostId === notification.id}
                onClick={() => handleNotificationClick(notification)}
              />
            ))
          ) : (
            <div className="py-16 text-center">
              <MailX className="h-10 w-10 mx-auto text-white/30 mb-3" />
              <p className="text-lg text-white/70">暂无通知</p>
              <p className="text-sm mt-2 text-white/40">
                当其他用户点赞或评论你的内容时，会在这里显示
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 帖子详情模态框（站内同款，横版布局） */}
      {activePost && (
        <PostDetailModal
          post={activePost}
          isOpen={!!activePost}
          onClose={handleModalClose}
          onLike={handleModalLike}
          onCommentAdded={() => {
            // 通知页不需要同步评论数，让模态框内部处理
          }}
          liked={modalLiked}
          likeCount={modalLikeCount}
          isLiking={modalIsLiking}
          username={activePost.username ?? "匿名"}
          avatarUrl={activePost.users?.avatar_url ?? null}
          isMobile={isMobile}
          isAdmin={isAdmin}
        />
      )}

      {/* 系统公告弹窗 */}
      <AnnouncementModal
        isOpen={!!activeAnnouncement}
        onClose={() => setActiveAnnouncement(null)}
        title={activeAnnouncement?.title ?? null}
        content={activeAnnouncement?.content ?? null}
        createdAt={activeAnnouncement?.created_at}
      />
    </Container>
  )
}
