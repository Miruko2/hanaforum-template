// app/profile/page.tsx
"use client"

import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useEffect, useState, useRef } from "react"
import Navbar from "@/components/navbar"
import BackgroundEffects from "@/components/background-effects"
import { useToast } from "@/hooks/use-toast"
import { ImagePlus, RotateCcw } from "lucide-react"
import {
  getOwnProfile,
  uploadAvatar,
  uploadBackground,
  getHomeBackground,
  uploadHomeBackground,
  clearHomeBackground,
  updateUsername,
  syncAuthUsername,
  updateBio,
  validateUsername,
  UsernameTakenError,
} from "@/lib/profiles"
import ProfileHeader from "./_components/profile-header"
import { toDisplayName } from "@/lib/display-name"
import FollowStats from "./_components/follow-stats"
import MyPosts from "./_components/my-posts"
import { getUserPosts } from "@/lib/supabase-optimized"
import type { Post } from "@/lib/types"
import { emitHomeBackgroundChanged } from "@/hooks/use-my-background"

// 「我的」页 = 编排层：持有页面级状态，handler 薄封装调用 lib/profiles 数据层，
// 再把状态/回调下发给 Banner 头部与设置菜单。头像、背景图各有一个隐藏文件 input
// （只此一处、由头部对应区域触发）。
export default function ProfilePage() {
  const { user } = useSimpleAuth()
  const { toast } = useToast()

  const [username, setUsername] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)
  // 首页背景：与上面 banner 的 backgroundUrl 完全独立的另一张图（home_background_url）
  const [homeBackgroundUrl, setHomeBackgroundUrl] = useState<string | null>(null)
  const [bio, setBio] = useState("")
  const [loading, setLoading] = useState(true)

  // 「我的帖子」
  const [posts, setPosts] = useState<Post[]>([])
  const [postsLoading, setPostsLoading] = useState(true)

  // 上传态
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingBackground, setUploadingBackground] = useState(false)
  const [uploadingHomeBackground, setUploadingHomeBackground] = useState(false)
  const [removingHomeBackground, setRemovingHomeBackground] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bgInputRef = useRef<HTMLInputElement>(null)
  const homeBgInputRef = useRef<HTMLInputElement>(null)

  // 用户名编辑态
  const [editingUsername, setEditingUsername] = useState(false)
  const [draftUsername, setDraftUsername] = useState("")
  const [savingUsername, setSavingUsername] = useState(false)

  // 签名编辑态
  const [editingBio, setEditingBio] = useState(false)
  const [draftBio, setDraftBio] = useState("")
  const [savingBio, setSavingBio] = useState(false)

  useEffect(() => {
    if (user) {
      const fetchProfile = async () => {
        // 先从 metadata 取 username（兜底）
        if (user.user_metadata?.username) {
          setUsername(toDisplayName(user.user_metadata.username))
        }
        // 再用 profiles 表覆盖（权威）
        const profile = await getOwnProfile(user.id)
        if (profile) {
          if (profile.username) setUsername(toDisplayName(profile.username))
          setAvatarUrl(profile.avatar_url || null)
          setBackgroundUrl(profile.background_url || null)
          setBio(profile.bio || "")
        }
        // 首页背景：独立字段、独立查询（迁移未跑则静默 null，不影响上面主资料）
        setHomeBackgroundUrl(await getHomeBackground(user.id))
        setLoading(false)
      }
      fetchProfile()
    } else {
      setLoading(false)
    }
  }, [user])

  // 拉取「我的帖子」（复用社交页同款数据源 getUserPosts）
  useEffect(() => {
    if (!user) {
      setPostsLoading(false)
      return
    }
    let alive = true
    setPostsLoading(true)
    getUserPosts(user.id)
      .then((ps) => {
        if (alive) setPosts(ps)
      })
      .finally(() => {
        if (alive) setPostsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [user])

  // ───────── 头像上传 ─────────
  const handleAvatarClick = () => avatarInputRef.current?.click()

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("图片大小不能超过 5MB")
      return
    }
    setUploadingAvatar(true)
    try {
      const url = await uploadAvatar(user.id, file)
      setAvatarUrl(url)
    } catch (err) {
      console.error("头像上传异常:", err)
      const e = err as { message?: string }
      alert(e?.message || "上传出错，请重试")
    } finally {
      setUploadingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ""
    }
  }

  // ───────── 背景图上传 ─────────
  const handleBgClick = () => bgInputRef.current?.click()

  const handleBgFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert("图片大小不能超过 5MB")
      return
    }
    setUploadingBackground(true)
    try {
      const url = await uploadBackground(user.id, file)
      setBackgroundUrl(url)
    } catch (err) {
      console.error("背景图上传异常:", err)
      const e = err as { message?: string }
      alert(e?.message || "上传出错，请重试")
    } finally {
      setUploadingBackground(false)
      if (bgInputRef.current) bgInputRef.current.value = ""
    }
  }

  // ───────── 首页背景（独立字段 home_background_url，与 banner 的 background_url 互不影响） ─────────
  const handleHomeBgClick = () => homeBgInputRef.current?.click()

  const handleHomeBgFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件")
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("图片大小不能超过 10MB")
      return
    }
    setUploadingHomeBackground(true)
    try {
      const url = await uploadHomeBackground(user.id, file)
      setHomeBackgroundUrl(url)
      emitHomeBackgroundChanged(url) // 即时刷新全站/ music 底图，无需刷新页面
      toast({ title: "首页背景已更新" })
    } catch (err) {
      console.error("首页背景上传异常:", err)
      const e = err as { message?: string }
      alert(e?.message || "上传出错，请重试")
    } finally {
      setUploadingHomeBackground(false)
      if (homeBgInputRef.current) homeBgInputRef.current.value = ""
    }
  }

  // 还原默认首页背景：置空 home_background_url（首页/全站底图回落站点默认）。可逆，无需二次确认。
  const handleHomeBgRemove = async () => {
    if (!user || removingHomeBackground) return
    setRemovingHomeBackground(true)
    try {
      await clearHomeBackground(user.id)
      setHomeBackgroundUrl(null)
      emitHomeBackgroundChanged(null) // 即时回落默认，无需刷新页面
      toast({ title: "已还原默认首页背景" })
    } catch (err) {
      const e = err as { message?: string }
      console.error("还原首页背景异常:", e)
      toast({ title: "还原失败", description: e?.message || "请稍后再试", variant: "destructive" })
    } finally {
      setRemovingHomeBackground(false)
    }
  }

  // ───────── 用户名编辑 ─────────
  const handleStartEditUsername = () => {
    setDraftUsername(username)
    setEditingUsername(true)
  }
  const handleCancelEditUsername = () => {
    setEditingUsername(false)
    setDraftUsername("")
  }
  const handleSaveUsername = async () => {
    if (!user || savingUsername) return

    const result = validateUsername(draftUsername)
    if (!result.ok) {
      toast({ title: "用户名不合法", description: result.error, variant: "destructive" })
      return
    }
    const newName = result.value
    if (newName === username) {
      setEditingUsername(false)
      return
    }

    setSavingUsername(true)
    try {
      // ① 更新 profiles（RLS 已限定 auth.uid()=id）
      try {
        await updateUsername(user.id, newName)
      } catch (err) {
        if (err instanceof UsernameTakenError) {
          toast({ title: "用户名已被占用", description: "请换一个", variant: "destructive" })
        } else {
          const e = err as { message?: string }
          toast({
            title: "保存失败",
            description: e?.message || "请稍后再试",
            variant: "destructive",
          })
        }
        return
      }

      // 主操作成功 → 先把 UI 切回展示态
      setUsername(newName)
      setEditingUsername(false)

      // ② 同步 auth.user_metadata.username（弹幕墙 AI 称呼依赖这个）
      try {
        await syncAuthUsername(newName)
      } catch (metaErr) {
        console.warn("同步 user_metadata 失败:", metaErr)
        toast({ title: "用户名已修改", description: "弹幕墙等部分场景下次登录才会生效" })
        return
      }

      toast({ title: "用户名已更新", description: `现在你叫「${newName}」` })
    } catch (err) {
      const e = err as { message?: string }
      console.error("修改用户名异常:", e)
      toast({
        title: "保存出错",
        description: e?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSavingUsername(false)
    }
  }

  // ───────── 签名编辑 ─────────
  const handleStartEditBio = () => {
    setDraftBio(bio)
    setEditingBio(true)
  }
  const handleCancelEditBio = () => {
    setEditingBio(false)
    setDraftBio("")
  }
  const handleSaveBio = async () => {
    if (!user || savingBio) return
    const value = draftBio.trim()
    if (value === bio.trim()) {
      setEditingBio(false)
      return
    }
    setSavingBio(true)
    try {
      await updateBio(user.id, value)
      setBio(value)
      setEditingBio(false)
      toast({ title: value ? "签名已更新" : "已清空签名" })
    } catch (err) {
      const e = err as { message?: string }
      console.error("保存签名异常:", e)
      toast({ title: "保存失败", description: e?.message || "请稍后再试", variant: "destructive" })
    } finally {
      setSavingBio(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen">
        <BackgroundEffects />
        <Navbar />
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-gray-400">加载中...</div>
        </div>
      </main>
    )
  }

  const avatarLetter =
    username?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U"

  return (
    <main className="min-h-screen">
      <BackgroundEffects />
      <Navbar />

      {/* 头像 / 背景图上传的隐藏 input（各一处，由头部对应区域触发） */}
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleAvatarFileChange}
      />
      <input
        ref={bgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleBgFileChange}
      />
      <input
        ref={homeBgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleHomeBgFileChange}
      />

      <div className="container mx-auto max-w-6xl px-4 pt-20 pb-10">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="w-full space-y-6 lg:w-[360px] lg:shrink-0">
          <ProfileHeader
            fallbackLetter={avatarLetter}
            avatarUrl={avatarUrl}
            backgroundUrl={backgroundUrl}
            username={username}
            bio={bio}
            edit={{
              avatar: { uploading: uploadingAvatar, onClick: handleAvatarClick },
              background: { uploading: uploadingBackground, onClick: handleBgClick },
              username: {
                editing: editingUsername,
                draft: draftUsername,
                saving: savingUsername,
                onDraftChange: setDraftUsername,
                onStartEdit: handleStartEditUsername,
                onSave: handleSaveUsername,
                onCancel: handleCancelEditUsername,
              },
              bio: {
                editing: editingBio,
                draft: draftBio,
                saving: savingBio,
                onDraftChange: setDraftBio,
                onStartEdit: handleStartEditBio,
                onSave: handleSaveBio,
                onCancel: handleCancelEditBio,
              },
            }}
          />

          {/* 首页背景：与个人卡片 banner 完全独立的另一张图（独立字段 home_background_url、
              独立隐藏 input + 独立上传/还原，与 banner 互不影响）。点击上传 → uploadHomeBackground
              压缩(2560/webp/0.85) → 由 AppBackground 渲染为首页/全站底图（切换有高斯模糊渐入）。右侧「还原默认」仅在
              已设时出现。 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleHomeBgClick}
              disabled={uploadingHomeBackground || removingHomeBackground}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-medium text-white/85 backdrop-blur-xl transition-colors hover:bg-white/20 hover:text-white disabled:opacity-50"
            >
              {uploadingHomeBackground ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {homeBackgroundUrl ? "更换首页背景" : "设置首页背景"}
            </button>
            {homeBackgroundUrl && (
              <button
                type="button"
                onClick={handleHomeBgRemove}
                disabled={removingHomeBackground || uploadingHomeBackground}
                aria-label="还原默认首页背景"
                title="还原默认首页背景"
                className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-3.5 py-3 text-white/60 backdrop-blur-xl transition-colors hover:bg-white/10 hover:text-white/85 disabled:opacity-50"
              >
                {removingHomeBackground ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
              </button>
            )}
          </div>

          {user && <FollowStats userId={user.id} />}
          </div>

          {/* 右栏：我的帖子（移动端落到资料下方） */}
          <div className="min-w-0 flex-1">
            <MyPosts posts={posts} loading={postsLoading} />
          </div>
        </div>
      </div>
    </main>
  )
}
