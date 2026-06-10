"use client"

import { useEffect, useRef } from "react"
import { Camera, Pencil, Check, X, ImagePlus } from "lucide-react"
import { BIO_MAX } from "@/lib/profiles"

// 一处可上传的图片槽（头像 / 背景图）
export interface UploadSlot {
  url: string | null
  uploading: boolean
  onClick: () => void
}

// 一个行内可编辑文本字段（用户名 / 签名），编辑态由父页面持有（受控）
export interface EditableField {
  value: string
  editing: boolean
  draft: string
  saving: boolean
  onDraftChange: (v: string) => void
  onStartEdit: () => void
  onSave: () => void
  onCancel: () => void
}

// 社交资料 Banner 头部（受控、纯 UI）：顶部背景图横幅 + 头像叠下沿 + 用户名 + 签名。
// 本人页传入可编辑字段/上传槽（显示相机/铅笔入口）；将来 /user/[id] 公开页可做一个
// 只读变体复用同一视觉。所有 hover 遮罩用纯色半透——不使用 backdrop-blur（规避安卓
// WebView 毛玻璃的鬼影/卡顿）。
// 注：不接收邮箱等私密字段——本组件将复用到公开页，私密信息一律不进这里，从源头杜绝泄露。
export interface ProfileHeaderProps {
  fallbackLetter: string
  avatar: UploadSlot
  background: UploadSlot
  username: EditableField
  bio: EditableField
}

export default function ProfileHeader({
  fallbackLetter,
  avatar,
  background,
  username,
  bio,
}: ProfileHeaderProps) {
  const nameInputRef = useRef<HTMLInputElement>(null)
  const bioInputRef = useRef<HTMLTextAreaElement>(null)

  // 进入编辑态自动聚焦
  useEffect(() => {
    if (username.editing) nameInputRef.current?.focus()
  }, [username.editing])
  useEffect(() => {
    if (bio.editing) bioInputRef.current?.focus()
  }, [bio.editing])

  return (
    <div className="profile-glass rounded-2xl overflow-hidden">
      {/* ───── 背景图 Banner ───── */}
      <div
        className="relative h-40 sm:h-48 w-full cursor-pointer group/bg"
        onClick={background.onClick}
      >
        {background.url ? (
          <img
            src={background.url}
            alt="背景图"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-lime-900/40 via-emerald-900/25 to-black/40" />
        )}
        {/* 底部渐变压暗，保证下方头像/名字可读 */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        {/* 更换背景图 hover 提示（纯色半透，无 blur） */}
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 text-white opacity-0 group-hover/bg:opacity-100 transition-opacity duration-300">
          {background.uploading ? (
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <ImagePlus className="w-5 h-5" />
              <span className="text-sm font-medium">更换背景</span>
            </>
          )}
        </div>
      </div>

      {/* ───── 头像 + 资料 ───── */}
      <div className="px-6 pb-6">
        {/* 头像：负 margin 叠到 banner 下沿 */}
        <div
          className="relative -mt-12 mb-3 inline-block cursor-pointer group/avatar"
          onClick={avatar.onClick}
        >
          <div className="w-24 h-24 rounded-full overflow-hidden bg-lime-900/40 flex items-center justify-center border-[3px] border-black/40 shadow-lg transition-transform duration-300 group-hover/avatar:scale-[1.03]">
            {avatar.url ? (
              <img src={avatar.url} alt="头像" className="w-full h-full object-cover" />
            ) : (
              <span className="text-3xl font-bold text-lime-400">{fallbackLetter}</span>
            )}
          </div>
          {/* 头像 hover 遮罩（纯色半透，无 blur） */}
          <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-300">
            {avatar.uploading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Camera className="w-5 h-5 text-white" />
            )}
          </div>
        </div>

        {/* 用户名 */}
        {username.editing ? (
          <div className="flex items-center gap-2 max-w-xs">
            <input
              ref={nameInputRef}
              type="text"
              value={username.draft}
              onChange={(e) => username.onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  username.onSave()
                } else if (e.key === "Escape") {
                  e.preventDefault()
                  username.onCancel()
                }
              }}
              disabled={username.saving}
              maxLength={20}
              placeholder="2-20 字符，中英数_-"
              className="flex-1 bg-white/5 border border-white/15 focus:border-lime-400/60 focus:outline-none rounded-lg px-3 py-1.5 text-white placeholder:text-white/30 text-lg font-semibold transition-colors disabled:opacity-50"
            />
            <button
              onClick={username.onSave}
              disabled={username.saving}
              aria-label="保存"
              className="p-1.5 rounded-lg bg-lime-500/20 hover:bg-lime-500/30 text-lime-400 transition-colors disabled:opacity-50"
            >
              {username.saving ? (
                <div className="w-4 h-4 border-2 border-lime-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={username.onCancel}
              disabled={username.saving}
              aria-label="取消"
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group/name">
            <h2 className="text-2xl font-bold text-white">{username.value || "用户"}</h2>
            <button
              onClick={username.onStartEdit}
              aria-label="编辑用户名"
              className="p-1.5 rounded-md text-white/30 hover:text-lime-400 hover:bg-white/5 opacity-0 group-hover/name:opacity-100 transition-all"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 签名 bio */}
        {bio.editing ? (
          <div className="mt-3">
            <textarea
              ref={bioInputRef}
              value={bio.draft}
              onChange={(e) => bio.onDraftChange(e.target.value.slice(0, BIO_MAX))}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault()
                  bio.onCancel()
                }
              }}
              disabled={bio.saving}
              maxLength={BIO_MAX}
              rows={3}
              placeholder="写点什么介绍自己…"
              className="w-full resize-none bg-white/5 border border-white/15 focus:border-lime-400/60 focus:outline-none rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 transition-colors disabled:opacity-50"
            />
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={bio.onSave}
                disabled={bio.saving}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-lime-500/20 hover:bg-lime-500/30 text-lime-400 text-sm transition-colors disabled:opacity-50"
              >
                {bio.saving ? (
                  <div className="w-3.5 h-3.5 border-2 border-lime-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                保存
              </button>
              <button
                onClick={bio.onCancel}
                disabled={bio.saving}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <span className="ml-auto text-[11px] tabular-nums text-white/40">
                {bio.draft.length}/{BIO_MAX}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-start gap-2 group/bio">
            <p className="flex-1 text-sm leading-relaxed whitespace-pre-line text-white/70">
              {bio.value || <span className="text-white/30">还没有签名，点右侧 ✎ 添加</span>}
            </p>
            <button
              onClick={bio.onStartEdit}
              aria-label="编辑签名"
              className="shrink-0 p-1.5 rounded-md text-white/30 hover:text-lime-400 hover:bg-white/5 opacity-0 group-hover/bio:opacity-100 transition-all"
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
