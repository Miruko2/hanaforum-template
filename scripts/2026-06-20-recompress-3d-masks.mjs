// scripts/2026-06-20-recompress-3d-masks.mjs
//
// 一次性把存量「3D 视差」帖子的遮罩从无损 PNG 重新编码成有损 webp，省存储/egress。
// 背景：发帖现抠的遮罩原先导出 PNG（lib/anime-matte 旧版），1024 灰度深度图 ~150-300KB。
// 2026-06-20 起客户端改导出 webp（~20-40KB，见 matteToWebpBlob + POST_MASK_EXT=webp）；
// 本脚本给改版前发的存量帖补转。遮罩是平滑深度图、渲染端还会再羽化，有损 webp 画质无感。
//
// 做法：对每个 image_mask_url 以 .png 结尾的帖：下载旧 _mask.png → sharp 转 webp →
//   传 _mask.webp → 更新 posts.image_mask_url 指向 webp → 删旧 _mask.png。
//   顺序保证「新文件 + DB 先就位，再删旧」，任一步失败即跳过该帖、不留半成品。
//   新文件名（_mask.webp ≠ _mask.png）→ CDN 是全新缓存键，无旧缓存污染。
//
// 用法（service role key 只从环境变量读，绝不写进文件 / 仓库 / 前端）：
//   预览（默认，不改动）：  node scripts/2026-06-20-recompress-3d-masks.mjs
//   真改：                  node scripts/2026-06-20-recompress-3d-masks.mjs --apply
//
// 依赖：@supabase/supabase-js、sharp。Node 22+（supabase-js 新版 createClient 需原生 WebSocket）。
//
// 安全护栏：
//   1. 默认 dry-run，必须 --apply 才真改；
//   2. 只处理 image_mask_url 以 .png 结尾的帖（已是 webp 的跳过）；不重跑抠像、只转码；
//   3. 顺序：传 webp → 更新 DB → 删旧 png；前一步失败不进行下一步。

import { createClient } from "@supabase/supabase-js"
import sharp from "sharp"

// URL 回退到 NEXT_PUBLIC_ 变体（.env.local 常只有它）；.trim() 防值里混入前导空格
// （Vercel 上踩过：NEXT_PUBLIC_SUPABASE_URL 带前导空格让 startsWith 静默失配）。
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim()
const BUCKET = "post-images"
const QUALITY = 85
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

const marker = `/${BUCKET}/`

// image_mask_url → 桶内对象名（无子目录）。例 .../post-images/abc_mask.png → abc_mask.png
function maskObjectName(url) {
  if (typeof url !== "string") return null
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  const name = decodeURIComponent(url.slice(idx + marker.length).split("?")[0])
  if (!name || name.includes("/")) return null
  return name
}

// 读全部带 image_mask_url 的帖，JS 端筛出 .png 结尾的（数量极少，分页读全表足够）
async function getPngMaskPosts() {
  const rows = []
  let from = 0
  for (;;) {
    const { data, error } = await admin
      .from("posts")
      .select("id, image_mask_url")
      .not("image_mask_url", "is", null)
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return rows
}

async function main() {
  console.log(`[mask-webp] bucket=${BUCKET} mode=${APPLY ? "APPLY" : "DRY-RUN"} quality=${QUALITY}`)

  const posts = await getPngMaskPosts()
  console.log(`[mask-webp] 带 image_mask_url 的帖：${posts.length} 个`)

  const todo = []
  for (const p of posts) {
    const pngName = maskObjectName(p.image_mask_url)
    if (!pngName || !/\.png$/i.test(pngName)) continue // 已是 webp / 解析不出 → 跳过
    const webpName = pngName.replace(/\.png$/i, ".webp")
    todo.push({ id: p.id, pngName, webpName })
  }
  console.log(`[mask-webp] 其中遮罩仍为 .png、待转 webp：${todo.length} 个`)

  if (todo.length === 0) {
    console.log("[mask-webp] 没有需要处理的遮罩。")
    return
  }

  if (!APPLY) {
    console.log("\n[mask-webp] DRY-RUN 预览：")
    for (const t of todo) console.log(`  post ${t.id}: ${t.pngName} → ${t.webpName}`)
    console.log("\n[mask-webp] 这是预览，未改动。确认无误后加 --apply 真改。")
    return
  }

  let done = 0
  let failed = 0
  let saved = 0
  for (const t of todo) {
    try {
      // 1) 下载旧 png
      const { data, error } = await admin.storage.from(BUCKET).download(t.pngName)
      if (error || !data) {
        console.error(`  ✗ 下载失败 ${t.pngName}: ${error?.message || "no data"}`)
        failed++
        continue
      }
      const input = Buffer.from(await data.arrayBuffer())
      // 2) 转 webp（不缩放，保持原分辨率，只换格式）
      const output = await sharp(input, { failOn: "none" }).webp({ quality: QUALITY }).toBuffer()
      // 3) 传 webp（新文件名，不覆盖任何现有文件）
      const { error: upErr } = await admin.storage.from(BUCKET).upload(t.webpName, output, {
        upsert: true,
        cacheControl: "31536000",
        contentType: "image/webp",
      })
      if (upErr) {
        console.error(`  ✗ 上传失败 ${t.webpName}: ${upErr.message}`)
        failed++
        continue
      }
      // 4) 更新 DB 指向 webp（image_mask_url 存 supabase 直链，渲染端 cdnUrl 再改写）
      const newUrl = admin.storage.from(BUCKET).getPublicUrl(t.webpName).data.publicUrl
      const { error: dbErr } = await admin.from("posts").update({ image_mask_url: newUrl }).eq("id", t.id)
      if (dbErr) {
        console.error(`  ✗ 更新 DB 失败 post ${t.id}: ${dbErr.message}（webp 已上传，DB 仍指旧 png，可重跑）`)
        failed++
        continue
      }
      // 5) 删旧 png（DB 已指向 webp，删旧安全）。删失败不算致命（旧 png 变孤儿，webp 已生效）
      const { error: rmErr } = await admin.storage.from(BUCKET).remove([t.pngName])
      if (rmErr) console.warn(`  ⚠ 删旧 png 失败（不影响，webp 已生效）${t.pngName}: ${rmErr.message}`)
      done++
      saved += Math.max(0, input.length - output.length)
      console.log(`  ✓ post ${t.id}: ${t.pngName} ${fmt(input.length)} → ${t.webpName} ${fmt(output.length)}`)
    } catch (e) {
      console.error(`  ✗ 异常 post ${t.id}: ${e?.message || e}`)
      failed++
    }
  }
  console.log(`\n[mask-webp] 完成：成功 ${done}，失败 ${failed}，共节省约 ${fmt(saved)}`)
}

main().catch((e) => {
  console.error("[mask-webp] 失败:", e)
  process.exit(1)
})
