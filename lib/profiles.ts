// lib/profiles.ts
//
// 个人资料数据层（统一收口 profiles 表的读写 + 头像/背景图上传 + 用户名校验）。
// 当前服务于 /profile「我的」页；后续社交个人页(/user/[id]) 直接复用。
//
// 注：lib/supabase.ts 里的 getUserProfile（带缓存、给「他人」展示用，被
// getPosts / getComments / 通知等大量调用）保持不动——本模块只负责
// 「当前登录用户自己」的资料读写，避免牵动既有调用方。

import { supabase } from "./supabaseClient"
import { compressImage } from "./image-compress"

// 个人资料。background_url / bio 为社交资料字段（见 scripts/2026-06-10-profiles-social-fields.sql）。
export type Profile = {
  id: string
  username: string | null
  avatar_url: string | null
  background_url: string | null
  bio: string | null
}

// 签名最大长度（与 DB CHECK 约束 profiles_bio_chk 保持一致）。
export const BIO_MAX = 200

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

// 按 id 读取一份资料（username/avatar/背景/签名）。profiles 的 SELECT 策略允许公开读
// 这些列（getPosts 等已在用），故「本人页」与「公开页 /user」共用同一实现。
// ⚠️ select 含 background_url/bio，需先在 Supabase 跑过加列迁移，否则会报 column 不存在。
async function selectProfileById(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, avatar_url, background_url, bio")
    .eq("id", userId)
    .single()
  if (error || !data) return null
  return data as Profile
}

// 读「自己」的资料
export const getOwnProfile = selectProfileById
// 读「任意用户」的公开资料（社交个人页 /user 用）
export const getPublicProfile = selectProfileById

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

// ───────── 写：签名 ─────────

// 写 profiles.bio（trim + 截断到 BIO_MAX 防御；DB CHECK 兜底）。允许空串=清空签名。
export async function updateBio(userId: string, bio: string): Promise<void> {
  const value = bio.trim().slice(0, BIO_MAX)
  const { error } = await supabase
    .from("profiles")
    .update({ bio: value })
    .eq("id", userId)
  if (error) throw error
}

// ───────── 写：图片（头像 / 背景图） ─────────

// 把压缩后的图片传 avatars 桶并返回 publicUrl。背景图复用 avatars 桶（已 public+RLS，
// 路径前缀 {userId}/ 满足该桶按用户隔离的 policy），免去单独建桶/配 policy。
//   · 文件名带时间戳唯一 → cacheControl 1 年，让浏览器/CDN 长缓存、不每小时回源
//     （3600 秒默认值是图片 Cached Egress 的放大器）。
async function uploadToAvatars(
  filePath: string,
  file: File,
  maxEdge: number,
  quality: number,
): Promise<string> {
  const { blob, ext, contentType } = await compressImage(file, maxEdge, quality)
  const path = `${filePath}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, blob, { upsert: true, cacheControl: "31536000", contentType })
  if (uploadError) throw uploadError
  return supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl
}

// ───────── 删旧图：换头像/背景或还原时清理 avatars 桶里的旧文件（孤儿） ─────────
//
// 上传用带时间戳的唯一文件名（每次换图都是新文件、不覆盖旧的），故需显式删旧文件、否则越换
// 越多。删之安全的前提：头像/背景在站内都按 profiles「当前列」实时读（avatarMap/actorMap 读取
// 时 JOIN），列一更新即全站指向新图、旧 URL 无人引用。全程 best-effort：删失败只告警、绝不抛、
// 绝不挡上传/还原主流程（旧文件最坏只是残留为孤儿，零 egress 影响）。

// 从存储公开 URL 解析出 avatars 桶内对象路径；非本桶 / 外链 / 解析不出 → null（绝不乱删）。
function avatarsObjectPath(publicUrl: string | null | undefined): string | null {
  if (!publicUrl) return null
  const marker = "/storage/v1/object/public/avatars/"
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return null
  const rel = publicUrl.slice(idx + marker.length).split("?")[0]
  try {
    return decodeURIComponent(rel) || null
  } catch {
    return rel || null
  }
}

// 删一个旧文件（best-effort）。给 keepUrl 时，旧路径与新文件相同则跳过——防御 Date.now()
// 同毫秒撞名把刚传上去的新图误删。
async function removeOldAvatarObject(oldUrl: string | null, keepUrl?: string): Promise<void> {
  const oldPath = avatarsObjectPath(oldUrl)
  if (!oldPath) return
  if (keepUrl && oldPath === avatarsObjectPath(keepUrl)) return
  try {
    const { error } = await supabase.storage.from("avatars").remove([oldPath])
    if (error) console.warn("删除旧图失败（忽略，保留为孤儿）:", error.message)
  } catch (e) {
    console.warn("删除旧图异常（忽略）:", e)
  }
}

// 头像上传：压缩到 256px webp/0.8（显示仅 40-112px，256 足够清晰）→ 传桶 → 写回
// profiles.avatar_url → 返回 publicUrl。失败 message 区分「上传失败」「更新记录失败」。
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const prev = (await getOwnProfile(userId))?.avatar_url ?? null
  let publicUrl: string
  try {
    publicUrl = await uploadToAvatars(`${userId}/${Date.now()}`, file, 256, 0.8)
  } catch (e) {
    throw new Error("头像上传失败: " + ((e as { message?: string })?.message ?? ""))
  }
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", userId)
  if (updateError) throw new Error("头像上传成功但更新记录失败")
  await removeOldAvatarObject(prev, publicUrl) // 删旧头像（best-effort）
  return publicUrl
}

// 背景图上传：背景图是整条大图，压缩到最大边 1280 / webp / 0.8（banner 显示足够清晰），
// 从源头压住 Cached Egress（背景图最易成为流量大头）→ 传桶 {userId}/bg_xxx → 写回
// profiles.background_url → 返回 publicUrl。
export async function uploadBackground(userId: string, file: File): Promise<string> {
  const prev = (await getOwnProfile(userId))?.background_url ?? null
  let publicUrl: string
  try {
    publicUrl = await uploadToAvatars(`${userId}/bg_${Date.now()}`, file, 1280, 0.8)
  } catch (e) {
    throw new Error("背景图上传失败: " + ((e as { message?: string })?.message ?? ""))
  }
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ background_url: publicUrl })
    .eq("id", userId)
  if (updateError) throw new Error("背景图上传成功但更新记录失败")
  await removeOldAvatarObject(prev, publicUrl) // 删旧 banner（best-effort）
  return publicUrl
}

// ───────── 写/读：首页背景（home_background_url，与 banner 的 background_url 完全独立） ─────────
//
// 这张图作为首页/全站底图（AppBackground 渲染层叠在 layout 默认底图上、切换高斯模糊渐入）+ music 页底图；
// banner 的 background_url 只管个人卡片，二者互不影响、各自上传/还原。
// 单独成列、单独查询：即便加列迁移（scripts/2026-06-20-profiles-home-background.sql）尚未跑，
// 也只让本功能静默失效（读返回 null / 写报错提示重试），绝不波及主资料(getOwnProfile)读取。

// 读首页背景；任何错误（含列不存在）→ null，本功能静默降级。
export async function getHomeBackground(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("home_background_url")
    .eq("id", userId)
    .maybeSingle()
  if (error || !data) return null
  return (data as { home_background_url: string | null }).home_background_url
}

// 上传首页背景：压缩到最大边 2560 / webp / 0.85（视觉接近无损、体积更省的平衡档）。首页背景是「全屏」底图（区别于只占小条幅的
// banner——故不沿用 banner 的 1280），2560 能覆盖到 1440p 桌面仍清晰、4K 也仅轻微放大；
// 显示侧用 background-size:cover / object-cover 随屏自适应（compressImage 只缩不放，
// 原图更小则保持原样、绝不上采样发虚）。egress 可控：首页背景是「私人」底图（只本人加载、
// CDN 边缘缓存 1 年），不像 banner 会被公开页大量他人下载。
// → 传桶 {userId}/homebg_xxx → 写回 home_background_url → 返回 publicUrl。
export async function uploadHomeBackground(userId: string, file: File): Promise<string> {
  const prev = await getHomeBackground(userId)
  let publicUrl: string
  try {
    publicUrl = await uploadToAvatars(`${userId}/homebg_${Date.now()}`, file, 2560, 0.85)
  } catch (e) {
    throw new Error("首页背景上传失败: " + ((e as { message?: string })?.message ?? ""))
  }
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ home_background_url: publicUrl })
    .eq("id", userId)
  if (updateError) throw new Error("首页背景上传成功但更新记录失败")
  await removeOldAvatarObject(prev, publicUrl) // 删旧首页背景（best-effort）
  return publicUrl
}

// 还原默认首页背景：置空 home_background_url（首页/全站底图回落站点默认）+ best-effort 删掉
// 原自定义图（避免还原后旧文件残留为孤儿）。删失败不影响还原本身（已置空、显示已回默认）。
export async function clearHomeBackground(userId: string): Promise<void> {
  const prev = await getHomeBackground(userId)
  const { error } = await supabase
    .from("profiles")
    .update({ home_background_url: null })
    .eq("id", userId)
  if (error) throw error
  await removeOldAvatarObject(prev)
}
