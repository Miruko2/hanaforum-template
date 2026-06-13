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

/**
 * Detects specifically the **Android Capacitor app** (Android System WebView) —
 * NOT a normal browser (desktop / iOS / Android Chrome).
 *
 * Used to scope the bottom-player ghosting workaround: the Android System
 * WebView carries a Chromium compositor bug where `preserve-3d` cards in
 * MusicCanvas paint over the fixed bottom player ("square ghost / flicker").
 * This bug does NOT reproduce in Android Chrome / iOS / desktop, so the
 * (visually lossy) card-occlusion fix must run ONLY inside the Android app.
 *
 * Detection prefers the Capacitor-injected runtime global, with the Android
 * System WebView UA token (`; wv)`, which Chrome lacks) as a robust fallback in
 * case the global isn't injected on a remotely-loaded (server.url) page.
 *
 * SSR-safe: starts `false`, only inspects `window`/`navigator` inside
 * `useEffect` → no hydration mismatch.
 */
export function useIsAndroidApp(): boolean {
  const [isAndroidApp, setIsAndroidApp] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const cap = (
      window as unknown as { Capacitor?: { getPlatform?: () => string } }
    ).Capacitor
    const fromCapacitor =
      typeof cap?.getPlatform === "function" && cap.getPlatform() === "android"
    const ua = navigator.userAgent || ""
    const fromWebViewUA = /Android/i.test(ua) && /;\s*wv\)/i.test(ua)
    setIsAndroidApp(Boolean(fromCapacitor || fromWebViewUA))
  }, [])
  return isAndroidApp
}
