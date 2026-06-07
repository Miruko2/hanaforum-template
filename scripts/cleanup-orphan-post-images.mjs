// scripts/cleanup-orphan-post-images.mjs
//
// 清理 Supabase Storage `post-images` 桶里的「孤儿图」——已删帖、不再被任何
// posts.image_url 引用的图片文件。删帖的多条路径历史上都漏删 storage 图
// （只有审核 edge function 删了），导致孤儿累积。本脚本兜底清理：存量一次清，
// 增量靠 GitHub Action 定期跑（见 .github/workflows/cleanup-orphan-images.yml）。
//
// 用法（service role key 只从环境变量读，绝不写进文件 / 仓库 / 前端）：
//   预览（默认，只打印不删）：
//     SUPABASE_URL=https://xxx.supabase.co \
//     SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//     node scripts/cleanup-orphan-post-images.mjs
//   真删（确认预览无误后再加 --delete）：
//     ...同上... node scripts/cleanup-orphan-post-images.mjs --delete
//
// 安全护栏：
//   1. 默认 dry-run，必须显式 --delete 才真删；
//   2. 只删创建时间早于 SAFE_AGE_HOURS（默认 24h）的文件，避免误删「刚上传、
//      帖子还没写进 posts 表」的图；
//   3. 严格按「不在 posts.image_url 引用集合」判定，且只动 post-images 桶。
//
// 注意：假设帖子图都直接存在桶根目录（当前上传逻辑 filePath=随机文件名，无子目录）。
//       若历史上有子目录文件，需扩展为递归 list。

import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = "post-images"
const SAFE_AGE_HOURS = Number(process.env.SAFE_AGE_HOURS || 24)
const DO_DELETE = process.argv.includes("--delete")

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "缺少环境变量 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（service role key 只从环境读，勿硬编码）",
  )
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// 从 posts.image_url 解析出「被引用的文件名」集合（分页读全表）。
async function getReferencedFilenames() {
  const referenced = new Set()
  const marker = `/${BUCKET}/`
  const pageSize = 1000
  let from = 0
  for (;;) {
    const { data, error } = await admin
      .from("posts")
      .select("image_url")
      .not("image_url", "is", null)
      .range(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      const url = row.image_url
      if (typeof url !== "string") continue
      const idx = url.indexOf(marker)
      if (idx === -1) continue
      const name = decodeURIComponent(url.slice(idx + marker.length).split("?")[0])
      if (name) referenced.add(name)
    }
    if (data.length < pageSize) break
    from += pageSize
  }
  return referenced
}

// 列出桶根目录所有文件（分页）。
async function listAllFiles() {
  const files = []
  const pageSize = 1000
  let offset = 0
  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET).list("", {
      limit: pageSize,
      offset,
      sortBy: { column: "created_at", order: "asc" },
    })
    if (error) throw error
    if (!data || data.length === 0) break
    files.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }
  return files
}

async function main() {
  console.log(
    `[cleanup] bucket=${BUCKET} mode=${DO_DELETE ? "DELETE" : "DRY-RUN"} safeAgeHours=${SAFE_AGE_HOURS}`,
  )

  const referenced = await getReferencedFilenames()
  console.log(`[cleanup] posts 引用的图片：${referenced.size} 个`)

  const files = await listAllFiles()
  console.log(`[cleanup] storage 文件总数：${files.length} 个`)

  const cutoff = Date.now() - SAFE_AGE_HOURS * 3600 * 1000
  const orphans = []
  let skippedYoung = 0
  for (const f of files) {
    // 跳过文件夹占位项（supabase 对前缀返回 id=null）
    if (!f || !f.name || f.id == null) continue
    if (referenced.has(f.name)) continue
    const created = f.created_at ? new Date(f.created_at).getTime() : 0
    if (created && created > cutoff) {
      skippedYoung++
      continue
    }
    orphans.push(f.name)
  }

  console.log(
    `[cleanup] 孤儿图：${orphans.length} 个（另跳过 ${skippedYoung} 个未到安全期的新文件）`,
  )
  if (orphans.length === 0) {
    console.log("[cleanup] 没有需要清理的孤儿图。")
    return
  }
  console.log("[cleanup] 示例（前 10）：", orphans.slice(0, 10))

  if (!DO_DELETE) {
    console.log("[cleanup] DRY-RUN 结束，未删除任何文件。确认无误后加 --delete 真删。")
    return
  }

  let deleted = 0
  for (let i = 0; i < orphans.length; i += 100) {
    const batch = orphans.slice(i, i + 100)
    const { error } = await admin.storage.from(BUCKET).remove(batch)
    if (error) {
      console.error("[cleanup] 删除批次失败：", error)
      continue
    }
    deleted += batch.length
    console.log(`[cleanup] 已删 ${deleted}/${orphans.length}`)
  }
  console.log(`[cleanup] 完成，共删除 ${deleted} 个孤儿图。`)
}

main().catch((e) => {
  console.error("[cleanup] 失败：", e)
  process.exit(1)
})
