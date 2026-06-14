// app/profile/page.tsx
"use client"

import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useEffect, useState, useRef } from "react"
import Navbar from "@/components/navbar"
import BackgroundEffects from "@/components/background-effects"
import { useToast } from "@/hooks/use-toast"
import {
  getOwnProfile,
  uploadAvatar,
  uploadBackground,
  updateUsername,
  syncAuthUsername,
  updateBio,
  validateUsername,
  UsernameTakenError,
} from "@/lib/profiles"
import ProfileHeader from "./_components/profile-header"
import FollowStats from "./_components/follow-stats"

// 「我的」页 = 编排层：持有页面级状态，handler 薄封装调用 lib/profiles 数据层，
// 再把状态/回调下发给 Banner 头部与设置菜单。头像、背景图各有一个隐藏文件 input
// （只此一处、由头部对应区域触发）。
export default function ProfilePage() {
  const { user } = useSimpleAuth()
  const { toast } = useToast()

  const [username, setUsername] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)
  const [bio, setBio] = useState("")
  const [loading, setLoading] = useState(true)

  // 上传态
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [uploadingBackground, setUploadingBackground] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bgInputRef = useRef<HTMLInputElement>(null)

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
          setUsername(user.user_metadata.username)
        }
        // 再用 profiles 表覆盖（权威）
        const profile = await getOwnProfile(user.id)
        if (profile) {
          if (profile.username) setUsername(profile.username)
          setAvatarUrl(profile.avatar_url || null)
          setBackgroundUrl(profile.background_url || null)
          setBio(profile.bio || "")
        }
        setLoading(false)
      }
      fetchProfile()
    } else {
      setLoading(false)
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

      <div className="flex items-center justify-center min-h-screen px-4 pt-20 pb-10">
        <div className="w-full max-w-lg space-y-6">
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

          {user && <FollowStats userId={user.id} />}
        </div>
      </div>
    </main>
  )
}
