"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Bell, X } from "lucide-react"
import { createPortal } from "react-dom"
import { useNotifications } from "@/contexts/notification-context"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useChatUI } from "@/contexts/chat-ui-context"
import { useToast } from "@/hooks/use-toast"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { LoadingAnimation } from "./ui/loading-animation"
import NotificationCard from "@/components/notification-card"
import PostDetailModal from "@/components/post-detail-modal"
import AnnouncementModal from "@/components/announcement-modal"
import { getPost, likePost, unlikePost, checkUserLiked, getAnnouncement } from "@/lib/supabase"
import { useRouter } from "next/navigation"
import type { Notification, Post } from "@/lib/types"

interface NotificationBellProps {
  mobileView?: boolean
}

export default function NotificationBell({ mobileView = false }: NotificationBellProps) {
  const { notifications, unreadCount, isLoading, markAsRead, markAllAsRead } =
    useNotifications()
  const { user, isAdmin } = useSimpleAuth()
  const { openHall } = useChatUI()
  const { toast } = useToast()
  const isMobile = useIsMobile()
  const router = useRouter()

  const [isOpen, setIsOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [loadingPostId, setLoadingPostId] = useState<string | null>(null)

  // 帖子详情模态框
  const [activePost, setActivePost] = useState<Post | null>(null)
  // 公告弹窗
  const [activeAnnouncement, setActiveAnnouncement] = useState<
    { title: string; content: string; image_url?: string | null; created_at: string } | null
  >(null)
  const [modalLiked, setModalLiked] = useState(false)
  const [modalLikeCount, setModalLikeCount] = useState(0)
  const [modalIsLiking, setModalIsLiking] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  // 弹窗打开时锁滚 + 标记已读。
  // ⚠️ 关闭时不在这里立即解锁滚动：解锁让滚动条回归 → 整页同步 reflow/重绘，
  // 会和退出动画抢同一帧主线程（面板还压着 backdrop-filter 要逐帧重采样背面），
  // 表现为「退出动画冻住不动、然后才消失」。解锁挪到 AnimatePresence 的
  // onExitComplete——动画播完、面板已卸载，再让页面重排。
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
      if (unreadCount > 0) {
        markAllAsRead().catch(() => {})
      }
    }
  }, [isOpen, unreadCount, markAllAsRead])

  // 兜底：组件整个卸载（如路由切换）时解锁，避免锁死页面滚动
  useEffect(() => {
    return () => {
      document.body.style.overflow = ""
    }
  }, [])

  // 点击通知卡片：弹出帖子详情
  const handleNotificationClick = useCallback(
    async (notification: Notification) => {
      try {
        if (!notification.is_read) {
          markAsRead(notification.id)
        }

        // 聊天提及：关铃铛弹窗 + 打开聊天切到大厅（@提及/引用都发生在大厅，无帖子可跳）
        if (notification.type === "chat_mention") {
          setIsOpen(false)
          openHall()
          return
        }

        // 公告类通知：打开公告弹窗（先关铃铛弹窗）
        if (notification.type === "announcement") {
          if (!notification.announcement_id) return
          setLoadingPostId(notification.id)
          try {
            const ann = await getAnnouncement(notification.announcement_id)
            if (ann) {
              setActiveAnnouncement(ann)
              setIsOpen(false)
            }
          } finally {
            setLoadingPostId(null)
          }
          return
        }

        if (!notification.post_id) {
          // follow 类型：跳到关注者(actor)的社交主页（先关铃铛弹窗）
          if (notification.type === "follow" && notification.actor_id) {
            setIsOpen(false)
            router.push(`/user?id=${notification.actor_id}`)
            return
          }
          return
        }

        setLoadingPostId(notification.id)
        const post = await getPost(notification.post_id)

        let userLiked = false
        if (user) {
          try {
            userLiked = !!(await checkUserLiked(post.id, user.id))
          } catch {
            // 点赞状态不是致命错误
          }
        }

        setActivePost(post as Post)
        setModalLiked(userLiked)
        setModalLikeCount((post as Post).likes_count ?? 0)
        // 关闭铃铛弹窗，让帖子详情独占视口
        setIsOpen(false)
      } catch (err: any) {
        console.error("打开帖子详情失败:", err)
        if (err?.message?.includes("不存在") || err?.code === "PGRST116") {
          toast({
            title: "帖子已被删除",
            description: "该通知对应的帖子不存在",
            variant: "destructive",
          })
          if (!notification.is_read) markAsRead(notification.id)
        } else {
          toast({
            title: "加载失败",
            description: "暂时无法加载帖子详情",
            variant: "destructive",
          })
        }
      } finally {
        setLoadingPostId(null)
      }
    },
    [markAsRead, user, toast, router, openHall],
  )

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

  // 移动端只显示未读数
  if (mobileView) {
    return unreadCount > 0 ? (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-lime-500 text-xs text-black font-medium shadow-lg animate-pulse">
        {unreadCount}
      </span>
    ) : null
  }

  const modalContent = (
    // 退出动画完整播完后再解锁滚动（见上方 effect 的注释）
    <AnimatePresence onExitComplete={() => { document.body.style.overflow = "" }}>
      {isOpen && (
        <motion.div
          key="notif-modal"
          className="fixed inset-0 z-[9999] flex items-center justify-center"
        >
          {/* 背景遮罩：半透明压暗 + 自身淡入淡出。
              ⚠️ 不要在面板的祖先上动画 opacity / 加 will-change:opacity——
              祖先 opacity<1 会形成 backdrop 边界，导致后代的 backdrop-filter 被整体忽略
              （表现为面板完全不磨砂、背景清晰透出）。所以淡入交给这层遮罩，
              外层容器不再animate opacity。 */}
          <motion.div
            className="absolute inset-0"
            style={{ background: "rgba(0, 0, 0, 0.45)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsOpen(false)}
          />

          {/* 通知面板：唯一的磨砂层。opacity/transform 都动画在毛玻璃元素自身上——
              这是安全的（只有「祖先」opacity<1 才会废掉后代 backdrop-filter，
              元素自己的 opacity 与 backdrop-filter 可共存，参照首页 .glass-card 入场）。
              之前退场只缩 3% 不淡出，肉眼读不出动效、像硬切。 */}
          <motion.div
            className="relative w-[95%] max-w-2xl max-h-[85vh] overflow-hidden flex flex-col rounded-2xl border border-white/15 shadow-2xl"
            style={{
              background: "rgba(20, 20, 28, 0.55)",
              backdropFilter: "blur(24px) saturate(150%)",
              WebkitBackdropFilter: "blur(24px) saturate(150%)",
            }}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            // 退出用确定性短 tween：淡出+缩小一起走，时长固定、马上让位
            //（滚动解锁在 onExitComplete 等着，不与动画抢主线程）
            exit={{ opacity: 0, scale: 0.94, y: 8, transition: { duration: 0.18, ease: "easeOut" } }}
            transition={{ type: "spring", stiffness: 340, damping: 30, mass: 0.8 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div
                  className="h-5 w-1 bg-lime-400 rounded-full"
                  style={{ boxShadow: "0 0 12px rgba(132,204,22,0.5)" }}
                />
                <h3 className="text-base font-semibold text-white">通知</h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* 内容列表 */}
            <div className="overflow-y-auto flex-1 p-4 space-y-2.5">
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <LoadingAnimation size="sm" color="text-lime-400" />
                </div>
              ) : notifications && notifications.length > 0 ? (
                notifications.map((notification) => (
                  <NotificationCard
                    key={notification.id}
                    notification={notification}
                    isLoadingThis={loadingPostId === notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    compact
                  />
                ))
              ) : (
                <div className="text-center py-12 text-white/50 text-sm">
                  暂无通知
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative mr-2"
        onClick={() => setIsOpen(true)}
      >
        <Bell className="h-5 w-5 text-gray-200" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-lime-500 text-xs text-black font-medium shadow-lg animate-pulse gpu-accelerated">
            {unreadCount}
          </span>
        )}
      </Button>

      {mounted && createPortal(modalContent, document.body)}

      {/* 帖子详情模态框（从通知弹出） */}
      {activePost && (
        <PostDetailModal
          post={activePost}
          isOpen={!!activePost}
          onClose={handleModalClose}
          onLike={handleModalLike}
          onCommentAdded={() => {}}
          liked={modalLiked}
          likeCount={modalLikeCount}
          isLiking={modalIsLiking}
          username={activePost.username ?? "匿名"}
          avatarUrl={activePost.users?.avatar_url ?? null}
          isMobile={isMobile}
          isAdmin={isAdmin}
        />
      )}

      {/* 系统公告弹窗（从通知弹出） */}
      <AnnouncementModal
        isOpen={!!activeAnnouncement}
        onClose={() => setActiveAnnouncement(null)}
        title={activeAnnouncement?.title ?? null}
        content={activeAnnouncement?.content ?? null}
        imageUrl={activeAnnouncement?.image_url ?? null}
        createdAt={activeAnnouncement?.created_at}
      />
    </>
  )
}
