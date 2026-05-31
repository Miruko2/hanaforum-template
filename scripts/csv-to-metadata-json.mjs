// 一次性工具：把 Supabase SQL Editor 导出的 CSV
// （section,data 两列，data 是 JSON 字符串）转成
// summarize-supabase-metadata.mjs 能吃的 JSON 数组。
//
// 用法：node scripts/csv-to-metadata-json.mjs <input.csv> <output.json>

import { readFile, writeFile } from "node:fs/promises"

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error("Usage: node scripts/csv-to-metadata-json.mjs <input.csv> <output.json>")
  process.exit(1)
}

const raw = await readFile(inPath, "utf8")

// 极简的 2 列 CSV 解析器：支持 RFC 4180 的双引号转义
// 不依赖第三方库，避免临时装 papaparse 之类
function parseCsv(text) {
  const rows = []
  let i = 0
  const n = text.length
  while (i < n) {
    const row = []
    while (i < n) {
      // 解析一个字段
      let field = ""
      if (text[i] === '"') {
        i++
        while (i < n) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              field += '"'
              i += 2
            } else {
              i++
              break
            }
          } else {
            field += text[i]
            i++
          }
        }
      } else {
        while (i < n && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
          field += text[i]
          i++
        }
      }
      row.push(field)
      if (text[i] === ",") {
        i++
        continue
      }
      break
    }
    rows.push(row)
    // 吃掉行尾的 \r\n / \n
    if (text[i] === "\r") i++
    if (text[i] === "\n") i++
  }
  return rows
}

const rows = parseCsv(raw)
const [header, ...dataRows] = rows
if (header[0] !== "section" || header[1] !== "data") {
  console.error("Unexpected CSV header:", header)
  process.exit(1)
}

// 过滤空行
const result = dataRows
  .filter((r) => r.length >= 2 && r[0])
  .map(([section, data]) => ({ section, data }))

await writeFile(outPath, JSON.stringify(result, null, 2), "utf8")
console.log(`Wrote ${result.length} sections to ${outPath}`)
