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
 * Detects specifically the **Android Capacitor app** (running inside Android
 * System WebView) — NOT a normal browser.
 *
 * Why this is narrower than `useIsAndroid`: the bottom music player uses
 * `backdrop-filter` (frosted glass). The Android System WebView that Capacitor
 * embeds carries a Chromium compositor bug where `preserve-3d` cards in
 * MusicCanvas bleed through the glass ("ghosting / garbled"). Crucially this
 * does NOT reproduce in Android **Chrome** (its newer/differently-configured
 * compositor is fine), nor on iOS WKWebView / desktop. So we must downgrade
 * ONLY the Android app and leave every browser on full frosted glass.
 *
 * Detection uses the Capacitor-injected runtime global instead of UA sniffing:
 *   window.Capacitor.getPlatform() === 'android'
 * which is true only inside the Android native app (returns 'web' in browsers,
 * 'ios' in the iOS app), so Android Chrome is correctly excluded.
 *
 * SSR-safe: starts `false`, only inspects `window` inside `useEffect`, so the
 * first client paint matches the server's frosted-glass output (no hydration
 * mismatch); the app downgrades on the next tick.
 */
export function useIsAndroidApp(): boolean {
  const [isAndroidApp, setIsAndroidApp] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor
    const platform = typeof cap?.getPlatform === "function" ? cap.getPlatform() : null
    setIsAndroidApp(platform === "android")
  }, [])
  return isAndroidApp
}
