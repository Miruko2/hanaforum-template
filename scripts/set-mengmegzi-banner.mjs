// scripts/set-mengmegzi-banner.mjs
//
// 给私信&论坛 AI「萌萌子」设置 / 更换资料卡背景图（banner，= profiles.background_url）。
// 萌萌子是 service-role 代管的 AI 账号、无法在网页登录上传，故用本脚本走后台写入。
//
// 用法（在项目根目录）：
//   node --env-file=.env.local scripts/set-mengmegzi-banner.mjs [图片路径]
//   不传路径时默认用根目录的 moe.jpg。
//
// 做的事：图片 → 上传 avatars 桶（与真人换 banner 同桶/同前缀 bg_）→ 取 https 公开链 →
//   写回 profiles.background_url。background_url 有 `^https://` CHECK 约束，Storage 公开链
//   恰是 https，满足。全程裸 fetch + service-role（不引 @supabase/supabase-js，避开其
//   RealtimeClient 对 Node22 原生 WebSocket 的依赖，与 scripts/create-mengmegzi-account.mjs 一致）。
//
// 注意：首次设置无旧图。将来换图重跑本脚本只写新文件、不删旧文件（旧文件残留为孤儿，
//   零 egress 影响，可忽略）；要彻底清理可去 Supabase Storage 控制台手删旧 bg_ 文件。

import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY（请用 --env-file=.env.local 运行）")
  process.exit(1)
}

// 萌萌子固定 user id（= lib/hanako/constants.ts 的 MENGMEGZI_USER_ID）
const MENGMEGZI_USER_ID = "78257113-e5da-4bcb-bb7a-9b1824439cd1"
const BUCKET = "avatars" // 头像/banner/首页背景同桶，用文件名前缀区分

const CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

const imgArg = process.argv[2] || "moe.jpg"
const imgPath = path.resolve(process.cwd(), imgArg)
if (!existsSync(imgPath)) {
  console.error(`找不到图片文件: ${imgPath}`)
  process.exit(1)
}
const ext = path.extname(imgPath).toLowerCase()
const contentType = CONTENT_TYPES[ext]
if (!contentType) {
  console.error(`不支持的图片类型: ${ext}（支持 jpg/jpeg/png/webp/gif）`)
  process.exit(1)
}

const bytes = await readFile(imgPath)
console.log(`读取图片: ${imgArg}  (${(bytes.length / 1024).toFixed(1)} KB, ${contentType})`)

// 1) 上传到 avatars 桶：{userId}/bg_{timestamp}.{ext}
const objectPath = `${MENGMEGZI_USER_ID}/bg_${Date.now()}${ext}`
const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
  method: "POST",
  headers: {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": contentType,
    "cache-control": "31536000", // 1 年，与 image-pipeline 一致
    "x-upsert": "true",
  },
  body: bytes,
})
if (!uploadRes.ok) {
  console.error("上传失败:", uploadRes.status, await uploadRes.text())
  process.exit(1)
}

const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectPath}`
console.log("上传成功 →", publicUrl)

// 2) 写回 profiles.background_url（return=representation 便于验证影响行）
const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${MENGMEGZI_USER_ID}`, {
  method: "PATCH",
  headers: {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  },
  body: JSON.stringify({ background_url: publicUrl }),
})
if (!patchRes.ok) {
  console.error("写 profiles.background_url 失败:", patchRes.status, await patchRes.text())
  process.exit(1)
}
const rows = await patchRes.json()
if (!Array.isArray(rows) || rows.length === 0) {
  console.error("⚠️ 更新影响 0 行——萌萌子的 profiles 行可能不存在，请先排查账号/触发器。")
  process.exit(1)
}

console.log("\n=== 萌萌子资料卡背景图设置成功 ===")
console.log("background_url =", rows[0].background_url)
console.log("刷新她的主页即可看到新 banner（前端无需改动 / 无需部署）。")
