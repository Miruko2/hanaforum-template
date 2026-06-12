"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from "@/components/ui/dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  getFollowCounts,
  getFollowers,
  getFollowing,
  type FollowUser,
} from "@/lib/follows"

// 「关注 / 粉丝」统计 + 点击查看名单。用在 /profile（看自己）。
//   · 两个可点的计数块：粉丝数、关注数。
//   · 点击任一打开弹窗，按需拉取对应名单；点名单里的人跳其社交主页 /user?id=。
export interface FollowStatsProps {
  userId: string
}

type Tab = "followers" | "following"

export default function FollowStats({ userId }: FollowStatsProps) {
  const router = useRouter()
  const [counts, setCounts] = useState({ followers: 0, following: 0 })
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>("followers")
  // 名单缓存：undefined = 尚未取过(显示加载中)，数组 = 已有数据(可直接展示)
  const [cache, setCache] = useState<Record<Tab, FollowUser[] | undefined>>({
    followers: undefined,
    following: undefined,
  })

  // 拉取某个名单并写入缓存（用于预取 + 打开时静默刷新）
  const fetchList = useCallback(
    async (which: Tab) => {
      const data =
        which === "followers" ? await getFollowers(userId) : await getFollowing(userId)
      setCache((prev) => ({ ...prev, [which]: data }))
    },
    [userId],
  )

  // 进入页面就并发取计数 + 预取两个名单，打开弹窗即时显示
  useEffect(() => {
    let alive = true
    setCache({ followers: undefined, following: undefined })
    getFollowCounts(userId).then((c) => {
      if (alive) setCounts(c)
    })
    void fetchList("followers")
    void fetchList("following")
    return () => {
      alive = false
    }
  }, [userId, fetchList])

  const openWith = (which: Tab) => {
    setTab(which)
    setOpen(true)
    void fetchList(which) // 后台静默刷新，缓存已有则不影响展示
  }

  const switchTab = (which: Tab) => {
    if (which === tab) return
    setTab(which)
    void fetchList(which)
  }

  const goProfile = (id: string) => {
    setOpen(false)
    router.push(`/user?id=${id}`)
  }

  const list = cache[tab]
  const listLoading = list === undefined

  return (
    <>
      <div className="profile-glass flex items-stretch rounded-2xl overflow-hidden">
        <button
          onClick={() => openWith("followers")}
          className="flex-1 px-4 py-4 text-center transition-colors hover:bg-white/5"
        >
          <div className="text-xl font-bold text-white tabular-nums">{counts.followers}</div>
          <div className="mt-0.5 text-xs text-white/50">粉丝</div>
        </button>
        <div className="w-px self-center h-8 bg-white/10" />
        <button
          onClick={() => openWith("following")}
          className="flex-1 px-4 py-4 text-center transition-colors hover:bg-white/5"
        >
          <div className="text-xl font-bold text-white tabular-nums">{counts.following}</div>
          <div className="mt-0.5 text-xs text-white/50">关注</div>
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          {/* 调淡遮罩并模糊背景页面，毛玻璃才看得出通透感 */}
          <DialogOverlay className="bg-black/40 backdrop-blur-md" />
          <DialogPrimitive.Content
            className="fixed left-1/2 top-1/2 z-50 grid w-full max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-3xl border border-white/20 bg-white/10 p-6 text-white shadow-2xl shadow-black/60 backdrop-blur-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          >
            <DialogTitle className="sr-only">关注与粉丝</DialogTitle>
            {/* 标签切换：绿色果冻药丸滑动指示器 */}
            <div className="relative flex items-center rounded-2xl bg-white/10 p-1">
              {/* 滑动层：负责在两个标签间平滑移动；内层负责果冻呼吸 */}
              <div
                className="pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] transition-transform duration-300 ease-out"
                style={{
                  transform: tab === "following" ? "translateX(100%)" : "translateX(0)",
                }}
              >
                <div className="h-full w-full rounded-xl animate-jelly-pulse" />
              </div>
              <button
                onClick={() => switchTab("followers")}
                className={
                  "relative z-10 flex-1 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors " +
                  (tab === "followers" ? "text-black" : "text-white/70 hover:text-white")
                }
              >
                粉丝 {counts.followers}
              </button>
              <button
                onClick={() => switchTab("following")}
                className={
                  "relative z-10 flex-1 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors " +
                  (tab === "following" ? "text-black" : "text-white/70 hover:text-white")
                }
              >
                关注 {counts.following}
              </button>
            </div>

            <div className="max-h-[55vh] overflow-y-auto overscroll-contain -mx-2 px-2">
              {listLoading ? (
                <div className="py-12 text-center text-sm text-white/50">加载中...</div>
              ) : !list || list.length === 0 ? (
                <div className="py-12 text-center text-sm text-white/50">
                  {tab === "followers" ? "还没有粉丝" : "还没有关注任何人"}
                </div>
              ) : (
                <ul className="space-y-1">
                  {list.map((u) => {
                    const name = u.username || "用户"
                    return (
                      <li key={u.id}>
                        <button
                          onClick={() => goProfile(u.id)}
                          className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-white/10"
                        >
                          <Avatar className="h-10 w-10 border border-white/20">
                            <AvatarImage src={u.avatar_url || "/placeholder.svg"} />
                            <AvatarFallback className="bg-black/40 text-sm text-white/80">
                              {name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-white">{name}</div>
                            {u.bio && (
                              <div className="truncate text-xs text-white/50">{u.bio}</div>
                            )}
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-full p-1 text-white/70 opacity-80 transition hover:bg-white/10 hover:opacity-100 focus:outline-none">
              <X className="h-4 w-4" />
              <span className="sr-only">关闭</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  )
}
