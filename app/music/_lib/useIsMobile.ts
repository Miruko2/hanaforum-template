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
 *     `backdrop-filter` + `preserve-3d` combo, so the size豁免 we give
 *     iPads is not safe to extend to Android.
 *
 * Lite mode disables the heaviest layers (looping video backdrop, film grain,
 * pointer parallax) and tones down `backdrop-filter: blur()` on each card.
 * The fisheye/3D effect itself is preserved, since it's the page's identity.
 *
 * Debug: append `?force=mobile` to force lite mode on any device — handy for
 * verifying the lite path on a desktop dev machine.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const forced =
      new URLSearchParams(window.location.search).get("force") === "mobile"
    if (forced) {
      setMobile(true)
      return
    }
    const mq = window.matchMedia(
      "(pointer: coarse) and (max-width: 1024px)",
    )
    const isAndroid = /Android/i.test(navigator.userAgent || "")
    const apply = () => setMobile(mq.matches || isAndroid)
    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [])
  return mobile
}
