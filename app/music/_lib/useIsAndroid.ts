"use client"

import { useEffect, useState } from "react"

/**
 * Detects Android devices (phones + tablets running Android Chrome / WebView).
 *
 * Why this exists: Android Chrome's GPU compositor has a long-standing bug
 * where combining `backdrop-filter` with an animated `filter` (e.g.
 * framer-motion `initial/animate/exit: { filter: "blur(...)" }`) tears the
 * layer's backing buffer during the transition — users see a momentary
 * "shattered / static-noise" flash on the affected element.
 *
 * iOS Safari runs a different rendering pipeline (WebKit + CoreAnimation /
 * Metal) and does NOT exhibit this bug; iPads and iPhones display normally.
 *
 * We therefore narrowly target Android only and fall back to a solid
 * semi-opaque background + skip the filter animation on those devices. All
 * other platforms keep the full frosted-glass effect.
 *
 * Note: SSR-safe — initial value is `false` and we only inspect
 * `navigator.userAgent` inside `useEffect`, so first paint matches the
 * server output and there's no hydration mismatch.
 */
export function useIsAndroid(): boolean {
  const [android, setAndroid] = useState(false)
  useEffect(() => {
    if (typeof navigator === "undefined") return
    setAndroid(/Android/i.test(navigator.userAgent))
  }, [])
  return android
}
