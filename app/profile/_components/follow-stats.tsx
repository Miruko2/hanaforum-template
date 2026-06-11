"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
  const [list, setList] = useState<FollowUser[]>([])
  const [listLoading, setListLoading] = useState(false)

  useEffect(() => {
    let alive = true
    getFollowCounts(userId).then((c) => {
      if (alive) setCounts(c)
    })
    return () => {
      alive = false
    }
  }, [userId])

  const loadList = useCallback(
    async (which: Tab) => {
      setListLoading(true)
      setList([])
      const data = which === "followers" ? await getFollowers(userId) : await getFollowing(userId)
      setList(data)
      setListLoading(false)
    },
    [userId],
  )

  const openWith = (which: Tab) => {
    setTab(which)
    setOpen(true)
    void loadList(which)
  }

  const switchTab = (which: Tab) => {
    if (which === tab) return
    setTab(which)
    void loadList(which)
  }

  const goProfile = (id: string) => {
    setOpen(false)
    router.push(`/user?id=${id}`)
  }

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
        <DialogContent className="max-w-sm border-white/10 bg-neutral-900/95 text-white">
          <DialogHeader>
            <DialogTitle className="sr-only">关注与粉丝</DialogTitle>
            {/* 标签切换 */}
            <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
              <button
                onClick={() => switchTab("followers")}
                className={
                  "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
                  (tab === "followers" ? "bg-lime-500 text-black" : "text-white/60 hover:text-white")
                }
              >
                粉丝 {counts.followers}
              </button>
              <button
                onClick={() => switchTab("following")}
                className={
                  "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors " +
                  (tab === "following" ? "bg-lime-500 text-black" : "text-white/60 hover:text-white")
                }
              >
                关注 {counts.following}
              </button>
            </div>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-y-auto -mx-2 px-2">
            {listLoading ? (
              <div className="py-12 text-center text-sm text-white/40">加载中...</div>
            ) : list.length === 0 ? (
              <div className="py-12 text-center text-sm text-white/40">
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
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/5"
                      >
                        <Avatar className="h-10 w-10 border border-white/15">
                          <AvatarImage src={u.avatar_url || "/placeholder.svg"} />
                          <AvatarFallback className="bg-black/40 text-sm text-white/80">
                            {name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-white">{name}</div>
                          {u.bio && (
                            <div className="truncate text-xs text-white/40">{u.bio}</div>
                          )}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
