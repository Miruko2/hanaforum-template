"use client"

import { useEffect, useRef } from "react"
import { Camera, Pencil, Check, X } from "lucide-react"

// 用户信息卡（受控、纯 UI）：头像圈 + 相机悬浮遮罩 + 用户名展示/行内编辑 + 邮箱。
// 所有状态/回调由父页面持有传入——因为头像、用户名各有「卡片内 + 设置菜单」两个
// 触发点，编辑态需在页面级共享。组件只负责呈现与本地交互（输入框聚焦/回车快捷键）。
export interface ProfileInfoCardProps {
  avatarUrl: string | null
  fallbackLetter: string
  email?: string
  uploading: boolean
  onAvatarClick: () => void
  // 用户名
  username: string
  editing: boolean
  draft: string
  saving: boolean
  onDraftChange: (v: string) => void
  onStartEdit: () => void
  onSave: () => void
  onCancel: () => void
}

export default function ProfileInfoCard({
  avatarUrl,
  fallbackLetter,
  email,
  uploading,
  onAvatarClick,
  username,
  editing,
  draft,
  saving,
  onDraftChange,
  onStartEdit,
  onSave,
  onCancel,
}: ProfileInfoCardProps) {
  const usernameInputRef = useRef<HTMLInputElement>(null)

  // 进入编辑态自动聚焦（替代页面里原本的 setTimeout focus）
  useEffect(() => {
    if (editing) usernameInputRef.current?.focus()
  }, [editing])

  const handleUsernameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault()
      onSave()
    } else if (e.key === "Escape") {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="profile-glass rounded-2xl p-10">
      <div className="flex flex-col items-center space-y-4">
        {/* 头像区域 */}
        <div className="relative group cursor-pointer" onClick={onAvatarClick}>
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
              <img src={avatarUrl} alt="头像" className="w-full h-full object-cover" />
            ) : (
              <span className="text-4xl font-bold text-lime-400">{fallbackLetter}</span>
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
        </div>

        {editing ? (
          <div className="flex items-center gap-2 w-full max-w-xs">
            <input
              ref={usernameInputRef}
              type="text"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={handleUsernameKeyDown}
              disabled={saving}
              maxLength={20}
              placeholder="2-20 字符，中英数_-"
              className="flex-1 bg-white/5 border border-white/15 focus:border-lime-400/60 focus:outline-none rounded-lg px-3 py-2 text-white placeholder:text-white/30 text-center text-lg font-semibold transition-colors disabled:opacity-50"
            />
            <button
              onClick={onSave}
              disabled={saving}
              aria-label="保存"
              className="p-2 rounded-lg bg-lime-500/20 hover:bg-lime-500/30 text-lime-400 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-lime-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={onCancel}
              disabled={saving}
              aria-label="取消"
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group/name">
            <h2 className="text-2xl font-bold text-white">{username || "用户"}</h2>
            <button
              onClick={onStartEdit}
              aria-label="编辑用户名"
              className="p-1.5 rounded-md text-white/30 hover:text-lime-400 hover:bg-white/5 opacity-0 group-hover/name:opacity-100 transition-all"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )}
        <p className="text-sm text-white/50">{email}</p>
      </div>
    </div>
  )
}
