"use client"

// 友链管理直链页 /admin/friend-links —— 薄壳：前端门禁 + 复用 FriendLinksPanel（与管理面板「友链」tab 同一组件）。
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import FriendLinksPanel from "@/components/admin/friend-links-panel"

export default function FriendLinksAdminPage() {
  const { user, isAdmin, loading } = useSimpleAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.replace("/")
  }, [loading, user, isAdmin, router])

  if (loading || !isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center text-white/60">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-lime-400" />
        {loading ? "加载中…" : "无权限，正在跳转…"}
      </main>
    )
  }

  return (
    <main className="min-h-screen text-white">
      <div className="container mx-auto max-w-3xl px-4 pt-24 pb-16">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">友链管理</h1>
        <FriendLinksPanel />
      </div>
    </main>
  )
}
