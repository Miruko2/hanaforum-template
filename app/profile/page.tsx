// app/profile/page.tsx
"use client"

import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useEffect, useState, useRef } from "react"
import { supabase } from "@/lib/supabaseClient"
import Navbar from "@/components/navbar"
import BackgroundEffects from "@/components/background-effects"
import { Bell, LogOut, ChevronRight, Camera, MessageSquare, Pencil, Check, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useToast } from "@/hooks/use-toast"

// 用户名校验：trim 后 2-20 字符，允许中英数 + 下划线 + 连字符
const USERNAME_RE = /^[一-龥a-zA-Z0-9_-]+$/
function validateUsername(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim()
  if (value.length < 2) return { ok: false, error: "用户名至少 2 个字符" }
  if (value.length > 20) return { ok: false, error: "用户名不能超过 20 个字符" }
  if (!USERNAME_RE.test(value)) return { ok: false, error: "只能包含中英文、数字、下划线和连字符" }
  return { ok: true, value }
}

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
  const usernameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (user) {
      const fetchProfile = async () => {
        // 先从 metadata 取 username
        if (user.user_metadata?.username) {
          setUsername(user.user_metadata.username)
        }
        // 从 profiles 表取 avatar_url 和 username
        const { data, error } = await supabase
          .from("profiles")
          .select("username, avatar_url")
          .eq("id", user.id)
          .single()
        if (!error && data) {
          if (data.username) setUsername(data.username)
          setAvatarUrl(data.avatar_url || null)
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
      // 生成唯一文件名: userId/timestamp.ext
      const ext = file.name.split(".").pop() || "jpg"
      const filePath = `${user.id}/${Date.now()}.${ext}`

      // 上传到 avatars bucket
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true })

      if (uploadError) {
        console.error("上传失败:", uploadError)
        alert("头像上传失败: " + uploadError.message)
        setUploading(false)
        return
      }

      // 获取公开 URL
      const { data: urlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath)

      const publicUrl = urlData.publicUrl

      // 更新 profiles 表
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", user.id)

      if (updateError) {
        console.error("更新头像URL失败:", updateError)
        alert("头像上传成功但更新记录失败")
      } else {
        setAvatarUrl(publicUrl)
      }
    } catch (err) {
      console.error("头像上传异常:", err)
      alert("上传出错，请重试")
    } finally {
      setUploading(false)
      // 清空 input 以便重复选择同一文件
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  // 进入编辑模式
  const handleStartEditUsername = () => {
    setDraftUsername(username)
    setEditingUsername(true)
    // 下一帧 focus，确保 input 已挂载
    setTimeout(() => usernameInputRef.current?.focus(), 0)
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
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({ username: newName })
        .eq("id", user.id)

      if (profileErr) {
        // 唯一约束冲突
        if ((profileErr as any).code === "23505") {
          toast({ title: "用户名已被占用", description: "请换一个", variant: "destructive" })
        } else {
          toast({
            title: "保存失败",
            description: profileErr.message || "请稍后再试",
            variant: "destructive",
          })
        }
        return
      }

      // 主操作成功 → 先把 UI 切回展示态
      setUsername(newName)
      setEditingUsername(false)

      // ② 同步 auth.user_metadata.username（弹幕墙 AI 称呼依赖这个）
      // 注：posts 表无 username 列（显示名靠前端 join profiles），所以不需要 UPDATE posts
      const { error: metaErr } = await supabase.auth.updateUser({
        data: { username: newName, displayName: newName },
      })

      if (metaErr) {
        console.warn("同步 user_metadata 失败:", metaErr)
        toast({
          title: "用户名已修改",
          description: "弹幕墙等部分场景下次登录才会生效",
        })
        return
      }

      // 全链路成功
      toast({ title: "用户名已更新", description: `现在你叫「${newName}」` })
    } catch (err: any) {
      console.error("修改用户名异常:", err)
      toast({
        title: "保存出错",
        description: err?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSavingUsername(false)
    }
  }

  // 编辑框回车/Esc 快捷键
  const handleUsernameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSaveUsername()
    } else if (e.key === "Escape") {
      e.preventDefault()
      handleCancelEditUsername()
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

      <div className="flex items-center justify-center min-h-screen px-4 pt-20">
        <div className="w-full max-w-lg space-y-6">
          {/* 用户信息卡片 */}
          <div className="profile-glass rounded-2xl p-10">
            <div className="flex flex-col items-center space-y-4">
              {/* 头像区域 */}
              <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
                {/* 头像外圈 lime 色光环，hover 时亮起 */}
                <div
                  className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                  style={{
                    boxShadow:
                      "0 0 0 2px rgba(132,204,22,0.4), 0 0 30px rgba(132,204,22,0.5)",
                  }}
                />
                <div className="w-28 h-28 rounded-full overflow-hidden bg-lime-900/30 flex items-center justify-center border border-white/10 transition-transform duration-300 group-hover:scale-[1.03]">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="头像"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-4xl font-bold text-lime-400">
                      {avatarLetter}
                    </span>
                  )}
                </div>
                {/* 悬浮遮罩 */}
                <div className="absolute inset-0 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {uploading ? (
                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Camera className="w-6 h-6 text-white" />
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>
              {editingUsername ? (
                <div className="flex items-center gap-2 w-full max-w-xs">
                  <input
                    ref={usernameInputRef}
                    type="text"
                    value={draftUsername}
                    onChange={(e) => setDraftUsername(e.target.value)}
                    onKeyDown={handleUsernameKeyDown}
                    disabled={savingUsername}
                    maxLength={20}
                    placeholder="2-20 字符，中英数_-"
                    className="flex-1 bg-white/5 border border-white/15 focus:border-lime-400/60 focus:outline-none rounded-lg px-3 py-2 text-white placeholder:text-white/30 text-center text-lg font-semibold transition-colors disabled:opacity-50"
                  />
                  <button
                    onClick={handleSaveUsername}
                    disabled={savingUsername}
                    aria-label="保存"
                    className="p-2 rounded-lg bg-lime-500/20 hover:bg-lime-500/30 text-lime-400 transition-colors disabled:opacity-50"
                  >
                    {savingUsername ? (
                      <div className="w-4 h-4 border-2 border-lime-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={handleCancelEditUsername}
                    disabled={savingUsername}
                    aria-label="取消"
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 transition-colors disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 group/name">
                  <h2 className="text-2xl font-bold text-white">
                    {username || "用户"}
                  </h2>
                  <button
                    onClick={handleStartEditUsername}
                    aria-label="编辑用户名"
                    className="p-1.5 rounded-md text-white/30 hover:text-lime-400 hover:bg-white/5 opacity-0 group-hover/name:opacity-100 transition-all"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              )}
              <p className="text-sm text-white/50">{user?.email}</p>
            </div>
          </div>

          {/* 选项列表 */}
          <div className="profile-glass rounded-2xl">
            <button
              className="profile-menu-item"
              onClick={handleAvatarClick}
            >
              <div className="flex items-center space-x-3">
                <Camera className="w-5 h-5 text-lime-400" />
                <span className="text-white">编辑头像</span>
              </div>
              <ChevronRight className="profile-menu-arrow w-5 h-5 text-white/40" />
            </button>

            <div className="h-px bg-white/5 mx-6" />

            <button
              className="profile-menu-item"
              onClick={handleStartEditUsername}
              disabled={editingUsername}
            >
              <div className="flex items-center space-x-3">
                <Pencil className="w-5 h-5 text-lime-400" />
                <span className="text-white">编辑用户名</span>
              </div>
              <ChevronRight className="profile-menu-arrow w-5 h-5 text-white/40" />
            </button>

            <div className="h-px bg-white/5 mx-6" />

            <button
              className="profile-menu-item"
              onClick={() => router.push("/notifications")}
            >
              <div className="flex items-center space-x-3">
                <Bell className="w-5 h-5 text-lime-400" />
                <span className="text-white">通知</span>
              </div>
              <ChevronRight className="profile-menu-arrow w-5 h-5 text-white/40" />
            </button>

            <div className="h-px bg-white/5 mx-6 md:hidden" />

            <button
              className="profile-menu-item md:hidden"
              onClick={() => router.push("/live")}
            >
              <div className="flex items-center space-x-3">
                <MessageSquare className="w-5 h-5 text-lime-400" />
                <span className="text-white">弹幕墙</span>
              </div>
              <ChevronRight className="profile-menu-arrow w-5 h-5 text-white/40" />
            </button>

            <div className="h-px bg-white/5 mx-6 md:hidden" />

            <button
              className="profile-menu-item danger"
              onClick={handleSignOut}
            >
              <div className="flex items-center space-x-3">
                <LogOut className="w-5 h-5 text-red-400" />
                <span className="text-red-400">退出登录</span>
              </div>
              <ChevronRight className="profile-menu-arrow w-5 h-5 text-white/40" />
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
