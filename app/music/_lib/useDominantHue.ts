"use client"

import { useEffect, useState } from "react"
import { apiUrl } from "@/lib/api-base"
import { cdnUrl } from "@/lib/cdn-url"

/**
 * Extracts the DOMINANT hue (0..359) from a remote cover image.
 *
 * "Dominant", not "average": this used to average every saturated pixel's hue
 * as a unit vector. On a multi-color cover that mean lands *between* the real
 * colors — a blue cover with warm skin/accent tones averages to a muddy green
 * that matches nothing on screen (the bug: the player/detail accent didn't look
 * like the art). Instead we build a saturation-weighted hue histogram and return
 * the centroid of the most-populated cluster, so the result is an actual
 * prominent color, not a blend of opposite ones.
 *
 * Loading strategy (canvas getImageData needs an untainted, readable image):
 *   · NetEase covers (music.126.net) send no CORS headers → routed through
 *     /api/img-proxy (host-allow-listed) so they come back same-origin. Covers
 *     built-in tracks AND user tracks imported from NetEase.
 *   · Everything else (user uploads on Supabase / the img CDN, which both send
 *     `Access-Control-Allow-Origin: *`) loads directly with crossOrigin. We do
 *     NOT proxy these: the proxy fetches server-side and these URLs are
 *     user-controlled (SSRF). Going through cdnUrl() also reuses the CF edge
 *     cache, so extraction adds no Supabase egress. A non-CORS / unreachable
 *     cover simply taints or errors → null → caller keeps its seeded fallback.
 *
 * Returns:
 *   - undefined while loading (caller should fall back to a default hue)
 *   - null if extraction failed or the image is effectively colorless
 *   - number 0..359 on success
 */
const SAMPLE_SIZE = 24 // 16→24: the histogram wants a few more samples than the old mean did
const HUE_BINS = 36 // 10° per bin
const cache = new Map<string, number | null>()

function isNetease(url: string): boolean {
  return /music\.126\.net/i.test(url)
}

export function useDominantHue(coverUrl: string | null | undefined): number | null | undefined {
  const [hue, setHue] = useState<number | null | undefined>(() =>
    coverUrl ? cache.get(coverUrl) : null,
  )

  useEffect(() => {
    if (!coverUrl) {
      setHue(null)
      return
    }
    if (cache.has(coverUrl)) {
      setHue(cache.get(coverUrl)!)
      return
    }

    let cancelled = false
    setHue(undefined)

    const img = new window.Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      if (cancelled) return
      try {
        const canvas = document.createElement("canvas")
        canvas.width = SAMPLE_SIZE
        canvas.height = SAMPLE_SIZE
        const ctx = canvas.getContext("2d", { willReadFrequently: true })
        if (!ctx) {
          cache.set(coverUrl, null)
          setHue(null)
          return
        }
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
        const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

        // Saturation-weighted hue histogram. Per bin we keep both the weight
        // (to locate the dominant cluster) and the summed unit vectors (to
        // recover that cluster's precise hue without the 360°/0° seam problem).
        const binW = new Float64Array(HUE_BINS)
        const binX = new Float64Array(HUE_BINS)
        const binY = new Float64Array(HUE_BINS)
        const binSize = 360 / HUE_BINS
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          const delta = max - min
          const lum = (r + g + b) / 3
          // Skip near-grayscale / very dark / very bright pixels — no hue signal.
          if (delta < 30 || lum < 28 || lum > 228) continue
          let h: number
          if (max === r) h = ((g - b) / delta) % 6
          else if (max === g) h = (b - r) / delta + 2
          else h = (r - g) / delta + 4
          h *= 60
          if (h < 0) h += 360
          // Weight vivid pixels more than washed-out ones.
          const sat = max === 0 ? 0 : delta / max
          const rad = (h * Math.PI) / 180
          let bin = Math.floor(h / binSize)
          if (bin >= HUE_BINS) bin = HUE_BINS - 1
          binW[bin] += sat
          binX[bin] += Math.cos(rad) * sat
          binY[bin] += Math.sin(rad) * sat
        }

        let total = 0
        for (let b = 0; b < HUE_BINS; b++) total += binW[b]
        if (total < 0.5) {
          cache.set(coverUrl, null)
          setHue(null)
          return
        }

        // Dominant cluster = the bin whose ±1 neighborhood holds the most weight
        // (a 3-bin / 30° window so a color straddling a bin edge isn't split in
        // two and beaten by a lesser-but-undivided color).
        let best = 0
        let bestScore = -1
        for (let b = 0; b < HUE_BINS; b++) {
          const prev = (b - 1 + HUE_BINS) % HUE_BINS
          const next = (b + 1) % HUE_BINS
          const score = binW[prev] + binW[b] + binW[next]
          if (score > bestScore) {
            bestScore = score
            best = b
          }
        }
        // Precise hue = vector centroid of the winning 3-bin cluster (seam-safe).
        const prev = (best - 1 + HUE_BINS) % HUE_BINS
        const next = (best + 1) % HUE_BINS
        const X = binX[prev] + binX[best] + binX[next]
        const Y = binY[prev] + binY[best] + binY[next]
        const angle = (Math.atan2(Y, X) * 180) / Math.PI
        const result = Math.round((angle + 360) % 360)
        cache.set(coverUrl, result)
        setHue(result)
      } catch {
        cache.set(coverUrl, null)
        setHue(null)
      }
    }
    img.onerror = () => {
      if (cancelled) return
      cache.set(coverUrl, null)
      setHue(null)
    }

    if (isNetease(coverUrl)) {
      // NetEase: no CORS → same-origin proxy. Downscale via the CDN's own param
      // (64×64 is plenty for a 24px sample) so the proxy moves ~40× fewer bytes.
      // Cache key stays the original coverUrl, transparent to callers.
      const sampleUrl = coverUrl.replace(/\bparam=\d+y\d+/, "param=64y64")
      img.src = apiUrl(`/api/img-proxy?url=${encodeURIComponent(sampleUrl)}`)
    } else {
      // User / own-CDN cover: CORS-enabled (Supabase + CF Worker set ACAO:*).
      // Load direct through cdnUrl() — no server proxy (no SSRF on user URLs),
      // reuses the edge cache (no extra Supabase egress).
      img.src = cdnUrl(coverUrl) || coverUrl
    }

    return () => {
      cancelled = true
    }
  }, [coverUrl])

  return hue
}
