"use client"

import { useEffect, useState } from "react"
import { METING_INSTANCES } from "./metingInstances"
import type { Track } from "../_data/tracks"

// 歌词获取与解析。复用 meting 公共实例（type=lrc 返回纯文本 LRC），从存库的
// audio URL 反解 server+id，无需改表结构。浏览器直连实例（CORS *），与歌单
// 解析同构：多实例主备回退，全挂视作无歌词（歌词非关键功能，静默降级）。

export type LyricLine = { time: number; text: string }

// 元信息行（作词/作曲/混音…），不属于可唱歌词，过滤掉。
const META_RE =
  /^\s*(作词|作曲|编曲|制作人?|混音|母带|录音|监制|出品|发行|演唱|和声|合声|吉他|贝斯|键盘|弦乐|鼓|打击乐|策划|统筹|企划|翻唱|原唱|曲绘|PV|OP|SP|by)\s*[:：]/i
// 纯音乐占位词——命中即视作无歌词。
const PURE_RE = /纯音乐|请欣赏|此歌曲为没有填词/
// 过滤后有效行少于此数视作无歌词（只有歌名/作者一两行的情况）。
const MIN_LINES = 4

function metingLyricRef(audioUrl: string): { server: string; id: string } | null {
  const server = audioUrl.match(/[?&]server=(netease|tencent)/)?.[1]
  const id = audioUrl.match(/[?&]id=([0-9A-Za-z]+)/)?.[1]
  if (!server || !id) return null
  return { server, id }
}

const TIME_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

/** 解析 LRC 文本为按时间升序的行数组。无时间戳的行（含 PHP 报错文本）被忽略。 */
export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const times: number[] = []
    TIME_RE.lastIndex = 0
    let lastEnd = 0
    let m: RegExpExecArray | null
    while ((m = TIME_RE.exec(raw)) && m.index === lastEnd) {
      const frac = m[3] ? Number(m[3].padEnd(3, "0")) / 1000 : 0
      times.push(Number(m[1]) * 60 + Number(m[2]) + frac)
      lastEnd = TIME_RE.lastIndex
    }
    const content = raw.slice(lastEnd).trim()
    if (times.length === 0 || !content) continue
    for (const t of times) out.push({ time: t, text: content })
  }
  out.sort((a, b) => a.time - b.time)
  return out
}

async function fetchLyrics(server: string, id: string): Promise<LyricLine[] | null> {
  for (const base of METING_INSTANCES) {
    let text: string
    try {
      const res = await fetch(`${base}?server=${server}&type=lrc&id=${encodeURIComponent(id)}`)
      if (!res.ok) continue
      text = await res.text()
    } catch {
      continue
    }
    const parsed = parseLrc(text)
    // 解析不出任何带时间戳的行 → 可能是实例挂了（HTTP 200 + 报错文本），换下一个。
    if (parsed.length === 0) continue

    const lines = parsed.filter((l) => !META_RE.test(l.text))
    if (lines.length < MIN_LINES || lines.some((l) => PURE_RE.test(l.text))) return null
    return lines
  }
  return null
}

const cache = new Map<string, LyricLine[] | null>()

/**
 * 取指定曲目的歌词。enabled=false 或非 meting 音源（自定义直链）或无有效歌词
 * 时返回 null。结果按歌曲缓存，会话内不重复请求。
 */
export function useLyrics(track: Track | null, enabled: boolean): LyricLine[] | null {
  const [lines, setLines] = useState<LyricLine[] | null>(null)
  const audio = track?.audio ?? ""

  useEffect(() => {
    setLines(null)
    if (!enabled || !audio) return
    const ref = metingLyricRef(audio)
    if (!ref) return
    const key = `${ref.server}:${ref.id}`
    if (cache.has(key)) {
      setLines(cache.get(key) ?? null)
      return
    }
    let alive = true
    fetchLyrics(ref.server, ref.id).then((r) => {
      cache.set(key, r)
      if (alive) setLines(r)
    })
    return () => {
      alive = false
    }
  }, [audio, enabled])

  return lines
}
