// scripts/cleanup-orphan-avatars.mjs
//
// 清理 Supabase Storage `avatars` 桶里的「孤儿文件」——不再被任何人引用的
// 旧头像 / 旧背景图。换头像、换背景图的上传逻辑（lib/profiles.ts）用时间戳
// 文件名写新文件 + 把 profiles 指向新 URL（文件名唯一才能配 1 年长缓存，
// 不能覆盖旧路径），旧文件从不删除 → 孤儿累积。本脚本兜底清理：
// 存量一次清，之后在 Actions 页随手手动触发（见
// .github/workflows/cleanup-orphan-avatars.yml）。
//
// 引用全集（三个来源，缺一就会误删）：
//   1. profiles.avatar_url      —— 头像
//   2. profiles.background_url  —— 社交页背景图（2026-06-10 加列，存同桶的 bg_* 文件）
//   3. auth.users.user_metadata.avatar_url —— 帖子详情页的头像兜底链（见 lib/supabase.ts）
// 注：compress-existing-avatars.mjs 早期的 --delete-orphans 只认来源 1，
//     在背景图上线后会误删全部 bg_*，已废弃，删除孤儿一律用本脚本。
//
// 用法（service role key 只从环境变量读，绝不写进文件 / 仓库 / 前端）：
//   预览（默认，只打印不删）：
//     SUPABASE_URL=https://xxx.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//     node scripts/cleanup-orphan-avatars.mjs
//   真删（确认预览无误后再加 --delete）：
//     ...同上... node scripts/cleanup-orphan-avatars.mjs --delete
//
// 安全护栏：
//   1. 默认 dry-run，必须显式 --delete 才真删；
//   2. 只删创建时间早于 SAFE_AGE_HOURS（默认 24h）的文件，避免误删「刚上传、
//      profiles 还没写回」的图；
//   3. 只动 avatars 桶；任一引用来源拉取失败整个脚本中止——绝不在引用不全时删。

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = "avatars"
const SAFE_AGE_HOURS = Number(process.env.SAFE_AGE_HOURS || 24)
const DO_DELETE = process.argv.includes("--delete")
const PAGE = 1000

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "缺少环境变量 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（service role key 只从环境读，勿硬编码）",
  )
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const fmt = (n) =>
  n >= 1048576 ? (n / 1048576).toFixed(2) + "MB" : (n / 1024).toFixed(0) + "KB"

// 把一条可能是本桶 publicUrl 的字符串解析成桶内路径；外链 / 别桶 / 空值返回 null。
function toBucketPath(url) {
  if (typeof url !== "string") return null
  const marker = `/${BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  const path = decodeURIComponent(url.slice(idx + marker.length).split("?")[0])
  return path || null
}

// 来源 1+2：profiles.avatar_url / background_url（分页读全表）
async function collectProfileRefs(referenced) {
  let from = 0
  for (;;) {
    const { data, error } = await admin
      .from("profiles")
      .select("avatar_url, background_url")
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      for (const u of [row.avatar_url, row.background_url]) {
        const p = toBucketPath(u)
        if (p) referenced.add(p)
      }
    }
    if (data.length < PAGE) break
    from += PAGE
  }
}

// 来源 3：auth.users.user_metadata.avatar_url（admin listUsers 分页）
async function collectAuthMetadataRefs(referenced) {
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE })
    if (error) throw error
    const users = data?.users ?? []
    for (const u of users) {
      const p = toBucketPath(u?.user_metadata?.avatar_url)
      if (p) referenced.add(p)
    }
    if (users.length < PAGE) break
    page += 1
  }
}

// 列某前缀下所有项（分页）
async function listPrefix(prefix) {
  const out = []
  let offset = 0
  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, {
      limit: PAGE,
      offset,
      sortBy: { column: "name", order: "asc" },
    })
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return out
}

// 列出全桶文件（结构：<uuid>/<file>，也兼容历史上根目录直放的文件）
async function listAllFiles() {
  const files = []
  const push = (path, entry) =>
    files.push({
      path,
      size: Number(entry.metadata?.size ?? 0),
      createdAt: entry.created_at ? new Date(entry.created_at).getTime() : 0,
    })
  const top = await listPrefix("")
  for (const entry of top) {
    if (!entry || !entry.name) continue
    if (entry.id == null) {
      // 文件夹（userId）→ 进去列文件
      const inner = await listPrefix(entry.name)
      for (const f of inner) {
        if (!f || !f.name || f.id == null) continue
        push(`${entry.name}/${f.name}`, f)
      }
    } else {
      push(entry.name, entry)
    }
  }
  return files
}

async function main() {
  console.log(
    `[cleanup-avatars] bucket=${BUCKET} mode=${DO_DELETE ? "DELETE" : "DRY-RUN"} safeAgeHours=${SAFE_AGE_HOURS}`,
  )

  // 任一来源抛错 → 整个脚本中止（catch 在最外层），不会拿着不全的引用集合去删
  const referenced = new Set()
  await collectProfileRefs(referenced)
  console.log(`[cleanup-avatars] profiles(头像+背景图) 引用：累计 ${referenced.size} 个路径`)
  await collectAuthMetadataRefs(referenced)
  console.log(`[cleanup-avatars] 并入 auth metadata 引用后：共 ${referenced.size} 个路径`)

  const files = await listAllFiles()
  console.log(`[cleanup-avatars] storage 文件总数：${files.length} 个`)

  const cutoff = Date.now() - SAFE_AGE_HOURS * 3600 * 1000
  const orphans = []
  let skippedYoung = 0
  for (const f of files) {
    if (referenced.has(f.path)) continue
    if (f.createdAt && f.createdAt > cutoff) {
      skippedYoung++
      continue
    }
    orphans.push(f)
  }

  const totalSize = orphans.reduce((s, f) => s + f.size, 0)
  console.log(
    `[cleanup-avatars] 孤儿文件：${orphans.length} 个，共 ${fmt(totalSize)}（另跳过 ${skippedYoung} 个未到安全期的新文件）`,
  )
  if (orphans.length === 0) {
    console.log("[cleanup-avatars] 没有需要清理的孤儿文件。")
    return
  }
  console.log("[cleanup-avatars] 示例（前 10）：")
  for (const f of orphans.slice(0, 10)) console.log(`  ${f.path}  ${fmt(f.size)}`)

  if (!DO_DELETE) {
    console.log(
      "[cleanup-avatars] DRY-RUN 结束，未删除任何文件。确认无误后加 --delete 真删。",
    )
    return
  }

  let deleted = 0
  const paths = orphans.map((f) => f.path)
  for (let i = 0; i < paths.length; i += 100) {
    const batch = paths.slice(i, i + 100)
    const { error } = await admin.storage.from(BUCKET).remove(batch)
    if (error) {
      console.error("[cleanup-avatars] 删除批次失败：", error)
      continue
    }
    deleted += batch.length
    console.log(`[cleanup-avatars] 已删 ${deleted}/${paths.length}`)
  }
  console.log(`[cleanup-avatars] 完成，共删除 ${deleted} 个孤儿文件，释放约 ${fmt(totalSize)}。`)
}

main().catch((e) => {
  console.error("[cleanup-avatars] 失败：", e)
  process.exit(1)
})
