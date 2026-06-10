// lib/profiles.ts
//
// 个人资料数据层（统一收口 profiles 表的读写 + 头像上传 + 用户名校验）。
// 当前服务于 /profile「我的」页；后续社交个人页(/user/[id]) 直接复用。
//
// 注：lib/supabase.ts 里的 getUserProfile（带缓存、给「他人」展示用，被
// getPosts / getComments / 通知等大量调用）保持不动——本模块只负责
// 「当前登录用户自己」的资料读写，避免牵动既有调用方。

import { supabase } from "./supabaseClient"
import { compressImage } from "./image-compress"

// 个人资料。社交化后会扩展 background_url / bio（本次不加）。
export type Profile = {
  id: string
  username: string | null
  avatar_url: string | null
}

// ───────── 用户名校验（纯函数，从 profile page 平移） ─────────

// trim 后 2-20 字符，允许中英数 + 下划线 + 连字符
export const USERNAME_RE = /^[一-龥a-zA-Z0-9_-]+$/

export type UsernameCheck =
  | { ok: true; value: string }
  | { ok: false; error: string }

export function validateUsername(raw: string): UsernameCheck {
  const value = raw.trim()
  if (value.length < 2) return { ok: false, error: "用户名至少 2 个字符" }
  if (value.length > 20) return { ok: false, error: "用户名不能超过 20 个字符" }
  if (!USERNAME_RE.test(value))
    return { ok: false, error: "只能包含中英文、数字、下划线和连字符" }
  return { ok: true, value }
}

// ───────── 读 ─────────

// 读自己的资料（username + avatar_url）。RLS 已限定 auth.uid()=id。
// 读不到返回 null（上层据此走兜底）。
export async function getOwnProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, avatar_url")
    .eq("id", userId)
    .single()
  if (error || !data) return null
  return data as Profile
}

// ───────── 写：用户名 ─────────

// 用户名唯一冲突的可识别错误，便于上层精准提示「已被占用」。
export class UsernameTakenError extends Error {
  constructor() {
    super("用户名已被占用")
    this.name = "UsernameTakenError"
  }
}

// 写 profiles.username（RLS 限定本人）。唯一冲突(code 23505)抛 UsernameTakenError，
// 其余错误原样抛出。
export async function updateUsername(userId: string, name: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ username: name })
    .eq("id", userId)
  if (error) {
    if ((error as { code?: string }).code === "23505") throw new UsernameTakenError()
    throw error
  }
}

// 同步 auth.user_metadata.username（弹幕墙 AI 称呼依赖这个）。
// 失败不致命——由上层决定如何提示（如「下次登录才生效」）。
export async function syncAuthUsername(name: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({
    data: { username: name, displayName: name },
  })
  if (error) throw error
}

// ───────── 写：头像 ─────────

// 头像上传全流程：压缩 → 传 avatars 桶(长缓存) → 写回 profiles.avatar_url → 返回 publicUrl。
//   · 压缩到 256px webp / 0.8（显示仅 40-112px，256 足够清晰），从源头砍 avatars 桶的
//     Cached Egress 大头。
//   · 文件名带时间戳唯一 → cacheControl 1 年，让浏览器/CDN 长缓存、不每小时回源。
// 失败抛 Error，message 区分「上传失败」与「上传成功但更新记录失败」，供上层提示。
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const { blob, ext, contentType } = await compressImage(file, 256, 0.8)
  const filePath = `${userId}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(filePath, blob, {
      upsert: true,
      cacheControl: "31536000",
      contentType,
    })
  if (uploadError) throw new Error("头像上传失败: " + uploadError.message)

  const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath)
  const publicUrl = urlData.publicUrl

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", userId)
  if (updateError) throw new Error("头像上传成功但更新记录失败")

  return publicUrl
}
