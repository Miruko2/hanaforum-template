"use client"

import { useEffect, useState } from "react"

/**
 * Platform detection for the music page's Android perf-degradation and the
 * WebView ghosting workarounds.
 *
 * WHY SYNCHRONOUS (first-frame-correct): these flags feed framer-motion
 * `initial` props — the frosted-glass entrance `filter` on ExpandedCard /
 * HistoryPanel. `initial` is read only on the mount frame. A detector that
 * returns the wrong value on first paint (the classic `useState(false)` +
 * `useEffect` flip) sets the NON-Android variant first; when we then swap to
 * the Android variant, framer-motion stops managing `filter` → blur sticks →
 * the panel/list is permanently blurred on Android. A footgun that does NOT
 * reproduce on desktop. So we read the UA / Capacitor global *synchronously
 * during render* and never start with a placeholder `false`.
 *
 * WHY THAT'S SSR-SAFE HERE: every consumer (MusicCanvas, MusicPlayer,
 * HistoryPanel, ExpandedCard) is dynamically imported with `{ ssr: false }`
 * (see app/music/page.tsx), so `navigator` is always defined when these run and
 * there is no server render to mismatch during hydration. Re-evaluate before
 * reusing these hooks in a component that DOES server-render.
 *
 * The Android-only targeting exists because Android Chrome's GPU compositor
 * tears the backing buffer when an animated `filter` overlaps a
 * `backdrop-filter` (momentary "shattered / static-noise" flash). iOS Safari
 * (WebKit + CoreAnimation / Metal) does not exhibit this, so iPhones/iPads keep
 * the full frosted-glass effect.
 */

function ua(): string {
  return typeof navigator !== "undefined" ? navigator.userAgent || "" : ""
}

/** Any Android device: phones, tablets, Android Chrome and the in-app WebView. */
export function detectIsAndroid(): boolean {
  return /Android/i.test(ua())
}

/**
 * Specifically the Capacitor Android app (Android System WebView), NOT a normal
 * browser (desktop / iOS / Android Chrome). Prefers the Capacitor-injected
 * runtime global; falls back to the System WebView UA token (`; wv)`, which
 * Chrome lacks) so the cold-start window on a remotely-loaded (server.url) page
 * — before the global is injected — is still covered.
 */
export function detectIsAndroidApp(): boolean {
  if (typeof window !== "undefined") {
    const cap = (
      window as unknown as { Capacitor?: { getPlatform?: () => string } }
    ).Capacitor
    if (typeof cap?.getPlatform === "function" && cap.getPlatform() === "android") {
      return true
    }
  }
  const s = ua()
  return /Android/i.test(s) && /;\s*wv\)/i.test(s)
}

/** Hook — sync-correct on the first frame (no useEffect flash). Safe to drive
 *  framer-motion `initial`. */
export function useIsAndroid(): boolean {
  return useState(detectIsAndroid)[0]
}

/**
 * Hook — sync-correct on the first frame via the UA token, plus a one-shot
 * re-check after mount in case the Capacitor global was injected late on a
 * remotely-loaded page (race) and the UA fallback hadn't matched yet.
 */
export function useIsAndroidApp(): boolean {
  const [v, setV] = useState(detectIsAndroidApp)
  useEffect(() => {
    if (!v) setV(detectIsAndroidApp())
  }, [v])
  return v
}
