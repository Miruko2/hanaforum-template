"use client"

import { useEffect, useState } from "react"

/**
 * Single source of truth for the platform / device-tier detection that drives
 * Android performance degradation across the music page. Previously this logic
 * was duplicated five ways (two async hooks + three inline `useState`/UA reads
 * in MusicCanvas, MusicPlayer, HistoryPanel, ExpandedCard), which is how the
 * "first-frame wrong" footgun kept reappearing. Everything funnels through here
 * now, so a new feature gets the same (correct) detection for free.
 *
 * Why synchronous: these flags feed framer-motion `initial` props (the frosted-
 * glass entrance on ExpandedCard / HistoryPanel). `initial` is only read on the
 * mount frame, so a detector returning the wrong value on first paint (the
 * classic `useState(false)` + `useEffect` pattern) sets the non-Android variant
 * first; when we then swap to the Android variant framer-motion stops managing
 * `filter` → blur sticks → panel permanently blurred on Android. A footgun that
 * does NOT reproduce on desktop. So detectors read UA / the Capacitor global
 * *synchronously during render*.
 *
 * Why that's SSR-safe here: every consumer (MusicCanvas, MusicPlayer,
 * HistoryPanel, ExpandedCard) is dynamically imported with `{ ssr: false }`
 * (see app/music/page.tsx), so `navigator` is always defined when these run and
 * there is no server render to mismatch during hydration.
 *
 * NOTE: this is the *device-tier / perf* axis. It is unrelated to the
 * responsive-layout `useIsMobile` in hooks/use-mobile.tsx (viewport width for
 * nav / layout) — deliberately kept separate.
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
 * browser. Prefers the Capacitor-injected runtime global; falls back to the
 * System WebView UA token (`; wv)`, which Chrome lacks) so the cold-start window
 * on a remotely-loaded (server.url) page — before the global is injected — is
 * still covered.
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

/** Hook form — sync-correct on the first frame (no useEffect flash). */
export function useIsAndroid(): boolean {
  return useState(detectIsAndroid)[0]
}

/**
 * Hook form. Sync-correct on the first frame via the UA token, plus a one-shot
 * re-check after mount in case the Capacitor global was injected late on a
 * remote-loaded page (race) and the UA fallback hadn't matched.
 */
export function useIsAndroidApp(): boolean {
  const [v, setV] = useState(detectIsAndroidApp)
  useEffect(() => {
    if (!v) setV(detectIsAndroidApp())
  }, [v])
  return v
}

/**
 * Device-tier signal for the music page's "lite" render (drops the looping
 * video backdrop, film grain, pointer parallax; lightens card blur). True when:
 *   1. coarse pointer AND viewport ≤ 1024px (phones), or
 *   2. any Android device — tablets included, since their GPUs / Chromium
 *      compositor can't afford this page's `backdrop-filter` + `preserve-3d`
 *      combo, so we do NOT extend the size exemption we give iPads.
 * Append `?force=mobile` to force it on for testing on a desktop.
 *
 * Subscribes to pointer / size changes, but initialises synchronously so the
 * first frame is already correct.
 */
export function useIsMobileTier(): boolean {
  const [mobile, setMobile] = useState(computeMobileTier)
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse) and (max-width: 1024px)")
    const apply = () => setMobile(computeMobileTier())
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
  return mobile
}

function computeMobileTier(): boolean {
  if (typeof window === "undefined") return false
  if (new URLSearchParams(window.location.search).get("force") === "mobile") {
    return true
  }
  const coarse = window.matchMedia(
    "(pointer: coarse) and (max-width: 1024px)",
  ).matches
  return coarse || detectIsAndroid()
}
