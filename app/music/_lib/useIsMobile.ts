"use client"

import { useEffect, useState } from "react"

/**
 * Detects "mobile-class" devices that should run the music page in lite mode.
 *
 * Criteria (OR):
 *   1. coarse pointer (= finger, not mouse) AND viewport ≤ 1024px → phones
 *   2. Android UA → all Android devices including large tablets
 *
 * Rationale:
 *   - desktops/laptops with mice: always full effect (neither rule fires)
 *   - iPad / iPad Pro: full effect (Apple GPU + Metal pipeline handles it)
 *   - Android phones: lite via rule 1
 *   - Android tablets (including large 11"/12"+): lite via rule 2 —
 *     Android tablet GPUs are far weaker than iPad Pro's and Chromium's
 *     compositor on Android already struggles with this page's
 *     `backdrop-filter` + `preserve-3d` combo, so the size exemption we give
 *     iPads is not safe to extend to Android.
 *
 * Lite mode disables the heaviest layers (looping video backdrop, film grain,
 * pointer parallax) and tones down `backdrop-filter: blur()` on each card.
 * The fisheye/3D effect itself is preserved, since it's the page's identity.
 *
 * Initialises SYNCHRONOUSLY (first frame already correct), then subscribes to
 * pointer/size changes. The sync init matters: a `useState(false)` + `useEffect`
 * flip would render the first frame as NON-lite on Android, mounting the heavy
 * 1080p `<VideoBackdrop>` + grain for one frame before tearing them down — a
 * wasteful churn/flash on a cold load of /music on the weakest devices. SSR-safe
 * because every music-page consumer is `{ ssr: false }` (see app/music/page.tsx).
 *
 * Debug: append `?force=mobile` to force lite mode on any device — handy for
 * verifying the lite path on a desktop dev machine.
 */

const LITE_MQ = "(pointer: coarse) and (max-width: 1024px)"

function computeMobile(): boolean {
  if (typeof window === "undefined") return false
  if (new URLSearchParams(window.location.search).get("force") === "mobile") {
    return true
  }
  const coarse = window.matchMedia(LITE_MQ).matches
  return coarse || /Android/i.test(navigator.userAgent || "")
}

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(computeMobile)
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia(LITE_MQ)
    const apply = () => setMobile(computeMobile())
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
  return mobile
}
