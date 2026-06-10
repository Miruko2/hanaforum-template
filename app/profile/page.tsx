// app/profile/page.tsx
"use client"

import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useEffect, useState, useRef } from "react"
import Navbar from "@/components/navbar"
import BackgroundEffects from "@/components/background-effects"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import {
  getOwnProfile,
  uploadAvatar,
  updateUsername,
  syncAuthUsername,
  validateUsername,
  UsernameTakenError,
} from "@/lib/profiles"
import ProfileInfoCard from "./_components/profile-info-card"
import ProfileSettingsList from "./_components/profile-settings-list"

// 「我的」页 = 编排层：持有页面级状态，handler 薄封装调用 lib/profiles 数据层，
// 再把状态/回调下发给信息卡与设置菜单。头像、用户名各有「卡片 + 菜单」两个触发点，
// 故编辑态在此集中持有，隐藏的文件 input 也只此一处、供两处共享。
export default function ProfilePage() {
  const { user, signOut } = useSimpleAuth()
  const router = useRouter()
  const { toast } = useToast()
  const [username, setUsername] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 用户名编辑态
  const [editingUsername, setEditingUsername] = useState(false)
  const [draftUsername, setDraftUsername] = useState("")
  const [savingUsername, setSavingUsername] = useState(false)

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
        }
        setLoading(false)
      }
      fetchProfile()
    } else {
      setLoading(false)
    }
  }, [user])

  const handleSignOut = async () => {
    await signOut()
    router.push("/")
  }

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return

    // 验证文件类型
    if (!file.type.startsWith("image/")) {
      alert("请选择图片文件")
      return
    }
    // 验证文件大小 (5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert("图片大小不能超过 5MB")
      return
    }

    setUploading(true)
    try {
      const publicUrl = await uploadAvatar(user.id, file)
      setAvatarUrl(publicUrl)
    } catch (err) {
      console.error("头像上传异常:", err)
      const e = err as { message?: string }
      alert(e?.message || "上传出错，请重试")
    } finally {
      setUploading(false)
      // 清空 input 以便重复选择同一文件
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  // 进入编辑模式（卡片自动聚焦输入框）
  const handleStartEditUsername = () => {
    setDraftUsername(username)
    setEditingUsername(true)
  }

  // 取消编辑
  const handleCancelEditUsername = () => {
    setEditingUsername(false)
    setDraftUsername("")
  }

  // 保存新用户名
  const handleSaveUsername = async () => {
    if (!user) return
    if (savingUsername) return

    // 1. 本地校验
    const result = validateUsername(draftUsername)
    if (!result.ok) {
      toast({ title: "用户名不合法", description: result.error, variant: "destructive" })
      return
    }
    const newName = result.value

    // 无变化直接退出，不发请求
    if (newName === username) {
      setEditingUsername(false)
      return
    }

    setSavingUsername(true)
    try {
      // ① 更新 profiles（RLS 已限定 auth.uid()=id，安全）
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
      // 注：posts 表无 username 列（显示名靠前端 join profiles），无需 UPDATE posts
      try {
        await syncAuthUsername(newName)
      } catch (metaErr) {
        console.warn("同步 user_metadata 失败:", metaErr)
        toast({
          title: "用户名已修改",
          description: "弹幕墙等部分场景下次登录才会生效",
        })
        return
      }

      // 全链路成功
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

      {/* 头像上传隐藏 input：单一来源，供「头像圈」与「编辑头像」菜单项共享触发 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex items-center justify-center min-h-screen px-4 pt-20">
        <div className="w-full max-w-lg space-y-6">
          <ProfileInfoCard
            avatarUrl={avatarUrl}
            fallbackLetter={avatarLetter}
            email={user?.email}
            uploading={uploading}
            onAvatarClick={handleAvatarClick}
            username={username}
            editing={editingUsername}
            draft={draftUsername}
            saving={savingUsername}
            onDraftChange={setDraftUsername}
            onStartEdit={handleStartEditUsername}
            onSave={handleSaveUsername}
            onCancel={handleCancelEditUsername}
          />

          <ProfileSettingsList
            onDownload={() => router.push("/download")}
            onNotifications={() => router.push("/notifications")}
            onSignOut={handleSignOut}
          />
        </div>
      </div>
    </main>
  )
}
