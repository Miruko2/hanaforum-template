#!/usr/bin/env node
/**
 * Refresh the NetEase Cloud Music playlist used by /music.
 *
 *   node scripts/refresh-playlist.mjs                    # default playlist
 *   node scripts/refresh-playlist.mjs <playlistId>       # different playlist
 *   node scripts/refresh-playlist.mjs <playlistId> <n>   # take first <n> tracks
 *
 * Writes to: app/music/_data/playlist.json
 *
 * Why a script (and not a runtime fetch):
 *  - injahow.cn is the upstream proxy; baking results means the page works
 *    even if injahow is briefly down at runtime.
 *  - Cover URLs get resolved here to permanent p{1..4}.music.126.net CDN URLs,
 *    so the only thing depending on injahow at runtime is audio playback
 *    (which already has a placeholder fallback).
 */
import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, "..")
const OUT_PATH = join(REPO_ROOT, "app/music/_data/playlist.json")

const playlistId = process.argv[2] || "2705159244"
const limit = Number(process.argv[3]) || 60

// Seeded PRNG so hue/ratio/span are stable across runs (avoids hydration drift
// if Next.js ever pre-renders parts of this).
function seededRand(seed) {
  let s = seed * 9301 + 49297
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

async function fetchPlaylist(id) {
  const url = `https://api.injahow.cn/meting/?type=playlist&id=${id}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Upstream returned ${res.status}: ${url}`)
  return res.json()
}

async function resolveCover(picUrl) {
  // injahow returns a 302; follow once manually and rewrite the size param.
  const res = await fetch(picUrl, { redirect: "manual" })
  const loc = res.headers.get("location")
  if (!loc) return picUrl
  return loc.replace(/param=\d+y\d+/, "param=400y400")
}

async function main() {
  console.log(`▸ Fetching playlist ${playlistId}…`)
  const raw = await fetchPlaylist(playlistId)
  console.log(`▸ Got ${raw.length} tracks; taking first ${limit}`)

  const slice = raw.slice(0, limit)
  const tracks = []
  for (let i = 0; i < slice.length; i++) {
    const t = slice[i]
    const r = seededRand(i + 1)
    const r1 = r(), r2 = r(), r3 = r()
    const span = r1 < 0.18 ? 2 : 1
    const ratio = span === 2 ? 0.7 + r2 * 0.35 : 1.0 + r2 * 0.7
    process.stdout.write(`\r▸ Resolving cover ${i + 1}/${slice.length}…`)
    const cover = await resolveCover(t.pic)
    tracks.push({
      id: `t-${i}`,
      title: t.name,
      artist: t.artist,
      cover,
      audio: t.url,
      hue: Math.floor(r3 * 360),
      ratio: Math.round(ratio * 10000) / 10000,
      span,
    })
  }
  process.stdout.write("\n")

  await writeFile(OUT_PATH, JSON.stringify(tracks, null, 2), "utf8")
  console.log(`✓ Wrote ${tracks.length} tracks to ${OUT_PATH}`)
}

main().catch((err) => {
  console.error("✗ Failed:", err.message)
  process.exit(1)
})
