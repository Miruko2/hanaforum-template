// scripts/compress-existing-avatars.mjs
//
// 一次性压缩 Supabase Storage `avatars` 桶里的存量老头像。
// 背景：头像此前原图直传（均 ~600KB）、Radix AvatarImage 原生 <img> 直连
// Supabase、全站高频显示 → Cached Egress 大头。上传压缩（lib/image-compress）
// 只对新头像生效，本脚本兜底把存量老头像也压小（256px webp）+ 设 1 年缓存。
//
// 用法（service role key 只从环境变量读，绝不写进文件 / 仓库 / 前端）：
//   预览（默认，不改动）：     node scripts/compress-existing-avatars.mjs
//   真压：                     node scripts/compress-existing-avatars.mjs --apply
//
// ⚠️ 原 --delete-orphans 已移除：它的孤儿判定只认 profiles.avatar_url，背景图
//   （2026-06-10 起存同桶的 bg_* 文件）上线后会把全部背景图误判成孤儿删掉。
//   删孤儿一律改用 scripts/cleanup-orphan-avatars.mjs（引用全集含背景图 +
//   auth metadata），workflow 见 .github/workflows/cleanup-orphan-avatars.yml。
//
// 依赖：@supabase/supabase-js、sharp。Node 22+（supabase-js 新版 createClient 需
//   原生 WebSocket，Node 20 会崩；见 .github/workflows/compress-avatars.yml 固定 node 22）。
//
// 安全护栏：
//   1. 默认 dry-run，必须 --apply 才真改；
//   2. 只压「被 profiles 引用的头像」且「≥ SKIP_BELOW」的文件，已小/已压的跳过；
//      背景图（bg_*）按 1280px 设计上传，不参与 256px 压缩；
//   3. 压完反而更大则不覆盖；GIF 跳过（避免丢动画）；
//   4. 覆盖写回原路径（不改 profiles.avatar_url），contentType 设 image/webp。

import { createClient } from "@supabase/supabase-js"
import sharp from "sharp"

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BUCKET = "avatars"
const MAX_EDGE = 256
const QUALITY = 80
const SKIP_BELOW = 60 * 1024 // 60KB 以下不压（大概率已小 / 已压过）
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

// profiles.avatar_url + background_url → 被引用的存储路径集合（形如 <uuid>/<ts>.<ext>）。
// 背景图也算引用：虽然它不参与压缩，但统计「孤儿」时不能把它误判进去。
async function getReferencedPaths() {
  const referenced = new Set()
  const marker = `/${BUCKET}/`
  let from = 0
  for (;;) {
    const { data, error } = await admin
      .from("profiles")
      .select("avatar_url, background_url")
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      for (const url of [row.avatar_url, row.background_url]) {
        if (typeof url !== "string") continue
        const idx = url.indexOf(marker)
        if (idx === -1) continue
        const path = decodeURIComponent(url.slice(idx + marker.length).split("?")[0])
        if (path) referenced.add(path)
      }
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  return referenced
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

// 递归列出 avatars 所有文件（结构：<uuid>/<file>，也兼容根目录直放）
async function listAllFiles() {
  const files = []
  const top = await listPrefix("")
  for (const entry of top) {
    if (!entry || !entry.name) continue
    if (entry.id == null) {
      // 文件夹（userId）→ 递归进去列文件
      const inner = await listPrefix(entry.name)
      for (const f of inner) {
        if (!f || !f.name || f.id == null) continue
        files.push({
          path: `${entry.name}/${f.name}`,
          size: Number(f.metadata?.size ?? 0),
          mimetype: f.metadata?.mimetype ?? "",
        })
      }
    } else {
      files.push({
        path: entry.name,
        size: Number(entry.metadata?.size ?? 0),
        mimetype: entry.metadata?.mimetype ?? "",
      })
    }
  }
  return files
}

async function main() {
  console.log(
    `[avatars] mode=${APPLY ? "APPLY" : "DRY-RUN"} maxEdge=${MAX_EDGE} quality=${QUALITY} skipBelow=${fmt(SKIP_BELOW)}`,
  )

  const referenced = await getReferencedPaths()
  console.log(`[avatars] profiles 引用的头像：${referenced.size} 个`)

  const files = await listAllFiles()
  console.log(`[avatars] storage 文件总数：${files.length} 个`)

  const orphans = files.filter((f) => !referenced.has(f.path))
  const inUse = files.filter((f) => referenced.has(f.path))
  console.log(`[avatars] 被引用 ${inUse.length} 个；孤儿 ${orphans.length} 个`)

  const isGif = (f) =>
    f.mimetype === "image/gif" || f.path.toLowerCase().endsWith(".gif")
  // 背景图（bg_*）按 1280px 设计上传（lib/profiles.ts uploadBackground），
  // 压到 256px 会毁掉 banner 清晰度，排除在压缩之外。
  const isBackground = (f) => /(^|\/)bg_/.test(f.path)
  const toCompress = inUse.filter(
    (f) => f.size >= SKIP_BELOW && !isGif(f) && !isBackground(f),
  )
  const skipSmall = inUse.length - toCompress.length
  console.log(
    `[avatars] 待压缩（被引用的头像且 ≥ ${fmt(SKIP_BELOW)}、非 gif）：${toCompress.length} 个；跳过 ${skipSmall} 个（已小 / gif / 背景图）`,
  )
  if (orphans.length) {
    console.log(
      `[avatars] 注：孤儿文件请用 scripts/cleanup-orphan-avatars.mjs 清理（本脚本不删）。`,
    )
  }

  if (toCompress.length === 0) {
    console.log("[avatars] 没有需要处理的文件。")
    return
  }

  if (!APPLY) {
    console.log("\n[avatars] DRY-RUN 预览 —— 待压缩前 20 个：")
    for (const f of toCompress.slice(0, 20)) console.log(`  ${f.path}  ${fmt(f.size)}`)
    const estIn = toCompress.reduce((s, f) => s + f.size, 0)
    console.log(`[avatars] 待压总大小约 ${fmt(estIn)}（压后通常降到原来的 5%~15%）`)
    console.log("\n[avatars] 这是预览，未改动。确认无误后加 --apply 真压。")
    return
  }

  let done = 0,
    saved = 0,
    failed = 0,
    skippedBigger = 0
  for (const f of toCompress) {
    try {
      const { data, error } = await admin.storage.from(BUCKET).download(f.path)
      if (error || !data) {
        console.error(`  ✗ 下载失败 ${f.path}: ${error?.message || "no data"}`)
        failed++
        continue
      }
      const input = Buffer.from(await data.arrayBuffer())
      const output = await sharp(input, { failOn: "none" })
        .rotate() // 按 EXIF 自动转正（手机照片常带方向信息）
        .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer()
      if (output.length >= input.length) {
        skippedBigger++
        continue // 压完反而更大，不动它
      }
      const { error: upErr } = await admin.storage.from(BUCKET).upload(f.path, output, {
        upsert: true,
        cacheControl: "31536000",
        contentType: "image/webp",
      })
      if (upErr) {
        console.error(`  ✗ 上传失败 ${f.path}: ${upErr.message}`)
        failed++
        continue
      }
      done++
      saved += input.length - output.length
      console.log(`  ✓ ${f.path}  ${fmt(input.length)} → ${fmt(output.length)}`)
    } catch (e) {
      console.error(`  ✗ 异常 ${f.path}: ${e?.message || e}`)
      failed++
    }
  }
  console.log(
    `\n[avatars] 压缩完成：成功 ${done}，失败 ${failed}，压后更大跳过 ${skippedBigger}，共节省 ${fmt(saved)}`,
  )
}

main().catch((e) => {
  console.error("[avatars] 失败:", e)
  process.exit(1)
})
