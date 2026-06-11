// scripts/backfill-post-image-thumbs.mjs
//
// 给 post-images 桶里的存量帖子主图回填 640px 缩略图。
// 背景：Vercel Image Optimization 免费额度爆掉后帖子图改为原生 <img> 直连
// Supabase，列表卡片按约定加载 `<base>_thumb.webp` 缩略图省 egress（约定见
// lib/post-image-thumb.ts）。新帖上传时由客户端同步生成缩略图，本脚本给
// 历史帖子补齐；没补到的帖子卡片端会 onError 回退主图，只是费流量不裂图。
//
// 用法（service role key 只从环境变量读，绝不写进文件 / 仓库 / 前端）：
//   预览（默认，不改动）：     node scripts/backfill-post-image-thumbs.mjs
//   真传：                     node scripts/backfill-post-image-thumbs.mjs --apply
//
// 依赖：@supabase/supabase-js、sharp。Node 22+（supabase-js 新版 createClient 需
//   原生 WebSocket，Node 20 会崩）。
//
// 安全护栏：
//   1. 默认 dry-run，必须 --apply 才真传；
//   2. 只给「被 posts.image_url 引用的主图」补缩略图；GIF 跳过（缩略图会丢动画，
//      消费端对 gif 直接用主图）；已有缩略图的跳过（upsert:false 双保险）；
//   3. 只新增 `<base>_thumb.webp` 文件，绝不覆盖/删除任何现有文件。

import { createClient } from "@supabase/supabase-js"
import sharp from "sharp"

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = "post-images"
const THUMB_EDGE = 640
const THUMB_QUALITY = 80
const PAGE = 1000
const APPLY = process.argv.includes("--apply")

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("缺少环境变量 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（service role key 只从环境读）")
  process.exit(1)
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const fmt = (n) =>
  n >= 1048576 ? (n / 1048576).toFixed(2) + "MB" : (n / 1024).toFixed(0) + "KB"

// 与 lib/post-image-thumb.ts 的 postThumbName 保持同一约定（.mjs 无法 import TS）
function thumbNameFor(mainName) {
  if (/\.gif$/i.test(mainName)) return null
  const dot = mainName.lastIndexOf(".")
  const base = dot > 0 ? mainName.slice(0, dot) : mainName
  return `${base}_thumb.webp`
}

// posts.image_url → 被引用的主图文件名集合（分页读全表）
async function getReferencedFilenames() {
  const referenced = new Set()
  const marker = `/${BUCKET}/`
  let from = 0
  for (;;) {
    const { data, error } = await admin
      .from("posts")
      .select("image_url")
      .not("image_url", "is", null)
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      const url = row.image_url
      if (typeof url !== "string") continue
      const idx = url.indexOf(marker)
      if (idx === -1) continue
      const name = decodeURIComponent(url.slice(idx + marker.length).split("?")[0])
      if (name && !name.includes("/")) referenced.add(name)
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  return referenced
}

// 列出桶根目录所有文件名 → Map<name, size>（帖子图都直接存根目录）
async function listAllFiles() {
  const files = new Map()
  let offset = 0
  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET).list("", {
      limit: PAGE,
      offset,
      sortBy: { column: "name", order: "asc" },
    })
    if (error) throw error
    if (!data || data.length === 0) break
    for (const f of data) {
      if (!f || !f.name || f.id == null) continue
      files.set(f.name, Number(f.metadata?.size ?? 0))
    }
    if (data.length < PAGE) break
    offset += PAGE
  }
  return files
}

async function main() {
  console.log(
    `[thumbs] bucket=${BUCKET} mode=${APPLY ? "APPLY" : "DRY-RUN"} edge=${THUMB_EDGE} quality=${THUMB_QUALITY}`,
  )

  const referenced = await getReferencedFilenames()
  console.log(`[thumbs] posts 引用的主图：${referenced.size} 个`)

  const files = await listAllFiles()
  console.log(`[thumbs] storage 文件总数：${files.size} 个`)

  const todo = []
  let skipGif = 0
  let skipHasThumb = 0
  let skipMissing = 0
  for (const name of referenced) {
    if (!files.has(name)) {
      skipMissing++ // 引用还在但文件已不在（裂图帖），不是本脚本要修的
      continue
    }
    const thumbName = thumbNameFor(name)
    if (!thumbName) {
      skipGif++
      continue
    }
    if (files.has(thumbName)) {
      skipHasThumb++
      continue
    }
    todo.push({ name, thumbName, size: files.get(name) })
  }
  console.log(
    `[thumbs] 待补缩略图：${todo.length} 个（已有 ${skipHasThumb}、gif ${skipGif}、引用失效 ${skipMissing}）`,
  )

  if (todo.length === 0) {
    console.log("[thumbs] 没有需要处理的文件。")
    return
  }

  if (!APPLY) {
    console.log("\n[thumbs] DRY-RUN 预览 —— 前 20 个：")
    for (const t of todo.slice(0, 20)) console.log(`  ${t.name}  ${fmt(t.size)} → ${t.thumbName}`)
    console.log("\n[thumbs] 这是预览，未改动。确认无误后加 --apply 真传。")
    return
  }

  let done = 0
  let failed = 0
  let added = 0
  for (const t of todo) {
    try {
      const { data, error } = await admin.storage.from(BUCKET).download(t.name)
      if (error || !data) {
        console.error(`  ✗ 下载失败 ${t.name}: ${error?.message || "no data"}`)
        failed++
        continue
      }
      const input = Buffer.from(await data.arrayBuffer())
      const output = await sharp(input, { failOn: "none" })
        .rotate() // 按 EXIF 自动转正
        .resize(THUMB_EDGE, THUMB_EDGE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: THUMB_QUALITY })
        .toBuffer()
      const { error: upErr } = await admin.storage.from(BUCKET).upload(t.thumbName, output, {
        upsert: false, // 只新增，绝不覆盖
        cacheControl: "31536000",
        contentType: "image/webp",
      })
      if (upErr) {
        console.error(`  ✗ 上传失败 ${t.thumbName}: ${upErr.message}`)
        failed++
        continue
      }
      done++
      added += output.length
      console.log(`  ✓ ${t.name}  ${fmt(input.length)} → ${t.thumbName}  ${fmt(output.length)}`)
    } catch (e) {
      console.error(`  ✗ 异常 ${t.name}: ${e?.message || e}`)
      failed++
    }
  }
  console.log(
    `\n[thumbs] 回填完成：成功 ${done}，失败 ${failed}，新增存储约 ${fmt(added)}`,
  )
}

main().catch((e) => {
  console.error("[thumbs] 失败:", e)
  process.exit(1)
})
