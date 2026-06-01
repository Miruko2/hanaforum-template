"use client"

import { useEffect, useState } from "react"
import { apiUrl } from "@/lib/api-base"

/**
 * Extracts the dominant hue (0..359) from a remote cover image.
 *
 * How:
 *   1. Loads the image through /api/img-proxy so it's same-origin (NetEase CDN
 *      doesn't return CORS headers, so a direct <img> taints the canvas).
 *   2. Draws it into a 16×16 canvas — small enough that the pixel loop is
 *      essentially free and aliasing already averages out tiny details.
 *   3. Skips near-grayscale and near-black/white pixels (they don't contribute
 *      to perceived hue), then averages the remaining hues as unit vectors
 *      weighted by saturation. Vector averaging is the only correct way to
 *      average angles — naive arithmetic mean breaks across the 360°/0° seam.
 *
 * Returns:
 *   - undefined while loading (caller should fall back to a default hue)
 *   - null if extraction failed or the image is effectively colorless
 *   - number 0..359 on success
 */
const SAMPLE_SIZE = 16
const cache = new Map<string, number | null>()

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

        let sumX = 0
        let sumY = 0
        let weight = 0
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const max = Math.max(r, g, b)
          const min = Math.min(r, g, b)
          const delta = max - min
          const lum = (r + g + b) / 3
          // Skip near-grayscale / very dark / very bright pixels — they carry
          // almost no hue information and would bias the average toward 0.
          if (delta < 30 || lum < 28 || lum > 228) continue
          let h: number
          if (max === r) h = ((g - b) / delta) % 6
          else if (max === g) h = (b - r) / delta + 2
          else h = (r - g) / delta + 4
          h *= 60
          if (h < 0) h += 360
          // Weight by saturation so vivid pixels matter more than washed-out
          // ones. Range [0, 1].
          const sat = max === 0 ? 0 : delta / max
          const rad = (h * Math.PI) / 180
          sumX += Math.cos(rad) * sat
          sumY += Math.sin(rad) * sat
          weight += sat
        }
        if (weight < 0.5) {
          cache.set(coverUrl, null)
          setHue(null)
          return
        }
        const angle = (Math.atan2(sumY, sumX) * 180) / Math.PI
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
    img.src = apiUrl(`/api/img-proxy?url=${encodeURIComponent(coverUrl)}`)

    return () => {
      cancelled = true
    }
  }, [coverUrl])

  return hue
}
