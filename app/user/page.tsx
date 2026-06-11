// app/user/page.tsx —— 公开社交个人页 /user?id=xxx
"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Navbar from "@/components/navbar"
import BackgroundEffects from "@/components/background-effects"
import ProfileHeader from "@/app/profile/_components/profile-header"
import PostTimeline from "./_components/post-timeline"
import ProfileActions from "./_components/profile-actions"
import { getPublicProfile, type Profile } from "@/lib/profiles"
import { getUserPosts } from "@/lib/supabase-optimized"
import type { Post } from "@/lib/types"

// 用查询参数路由（/user?id=xxx）而非动态段（/user/[id]）：后者在 Capacitor 静态导出
// (output:'export') 下需 generateStaticParams、否则 APK 构建失败。查询参数是单个静态页
// + 客户端读 id，export 与 Vercel 都安全，且与首页 ?category 同一模式（需 Suspense 包裹）。
function UserProfileContent() {
  const searchParams = useSearchParams()
  const id = searchParams?.get("id") || null

  const [profile, setProfile] = useState<Profile | null>(null)
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      setNotFound(true)
      return
    }
    let alive = true
    setLoading(true)
    setNotFound(false)
    ;(async () => {
      const [p, ps] = await Promise.all([getPublicProfile(id), getUserPosts(id)])
      if (!alive) return
      if (!p) {
        setNotFound(true)
        setLoading(false)
        return
      }
      setProfile(p)
      setPosts(ps)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [id])

  const username = profile?.username || (id ? `用户_${id.slice(0, 6)}` : "用户")
  const fallbackLetter = username?.[0]?.toUpperCase() || "U"

  return (
    <main className="min-h-screen">
      <BackgroundEffects />
      <Navbar />

      <div className="container mx-auto px-4 pt-20 pb-10 max-w-3xl">
        {loading ? (
          <div className="flex items-center justify-center min-h-[40vh] text-gray-400">加载中...</div>
        ) : notFound || !profile ? (
          <div className="flex flex-col items-center justify-center min-h-[40vh] text-gray-400">
            <div className="text-4xl mb-3">👻</div>
            <p className="text-xl">用户不存在</p>
          </div>
        ) : (
          <div className="space-y-6">
            <ProfileHeader
              fallbackLetter={fallbackLetter}
              avatarUrl={profile.avatar_url}
              backgroundUrl={profile.background_url}
              username={username}
              bio={profile.bio || ""}
              actions={
                <ProfileActions
                  targetId={profile.id}
                  targetName={username}
                  targetAvatar={profile.avatar_url}
                />
              }
            />

            <section>
              <h3 className="mb-3 text-sm tracking-widest uppercase text-white/40">
                Ta 的帖子 · {posts.length}
              </h3>
              {posts.length > 0 ? (
                <PostTimeline posts={posts} />
              ) : (
                <div className="py-16 text-center text-white/40">Ta 还没有发过帖子</div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  )
}

export default function UserProfilePage() {
  return (
    <Suspense fallback={null}>
      <UserProfileContent />
    </Suspense>
  )
}
