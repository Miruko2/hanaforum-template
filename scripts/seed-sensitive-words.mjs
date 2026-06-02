// 生成敏感词导入 SQL（仅政治类，来源 konsheng/Sensitive-lexicon）。
//
// 用法：  node scripts/seed-sensitive-words.mjs
// 产物：  scripts/seed-sensitive-words.generated.sql （已 gitignore，含敏感词，勿提交）
//        生成后把它的内容贴进 Supabase SQL Editor 执行，即可灌入 sensitive_words 表。
//
// 处理：换行分隔 → 去首尾空白 → 去空行 → 按小写去重 → 滤掉单字（降误杀）。
// 注：词库不写进仓库，只落到本地 generated.sql；脚本本身不含任何敏感词。

import { writeFile } from "node:fs/promises"

// konsheng 仓库里的政治类原文件（raw）。如仓库默认分支不是 main，改成 master 即可。
const RAW_URL =
  "https://raw.githubusercontent.com/konsheng/Sensitive-lexicon/main/Vocabulary/%E6%94%BF%E6%B2%BB%E7%B1%BB%E5%9E%8B.txt"

// 最小词长：丢掉单字（如"习""江"），否则子串匹配会把"习惯""江苏"全误杀。
// 按 Unicode code point 计长，对中文准确。需要保留某些单字可上线后手动加。
const MIN_LEN = 2

const OUT_URL = new URL("./seed-sensitive-words.generated.sql", import.meta.url)

const sqlEscape = (s) => s.replace(/'/g, "''")

async function main() {
  console.log("正在下载政治类词库 …")
  const res = await fetch(RAW_URL)
  if (!res.ok) {
    console.error(`下载失败：HTTP ${res.status}。若是 404，把脚本里的 main 改成 master 再试。`)
    process.exit(1)
  }
  const raw = await res.text()

  const seen = new Set()
  const words = []
  let dropShort = 0
  let dropDup = 0

  for (const line of raw.split(/\r?\n/)) {
    const w = line.trim()
    if (!w) continue
    if ([...w].length < MIN_LEN) {
      dropShort++
      continue
    }
    const key = w.toLowerCase()
    if (seen.has(key)) {
      dropDup++
      continue
    }
    seen.add(key)
    words.push(w)
  }

  if (words.length === 0) {
    console.error("处理后没有任何词，可能下载内容异常，已中止。")
    process.exit(1)
  }

  const values = words.map((w) => `  ('${sqlEscape(w)}', '政治')`).join(",\n")
  const sql =
    `-- 自动生成，请勿提交进仓库。由 scripts/seed-sensitive-words.mjs 生成。\n` +
    `-- 来源：konsheng/Sensitive-lexicon Vocabulary/政治类型.txt（仅政治类，已去重、滤掉单字）\n` +
    `-- 共 ${words.length} 条。直接在 Supabase SQL Editor 执行即可。\n\n` +
    `INSERT INTO public.sensitive_words (word, category) VALUES\n${values}\n` +
    `ON CONFLICT (lower(word)) DO NOTHING;\n`

  await writeFile(OUT_URL, sql, "utf8")

  console.log(`完成：${words.length} 条（滤掉单字 ${dropShort}，去重 ${dropDup}）`)
  console.log(`已写出 → ${OUT_URL.pathname}`)
  console.log("下一步：把该文件内容贴进 Supabase SQL Editor 执行。")
}

main().catch((e) => {
  console.error("脚本异常：", e)
  process.exit(1)
})
