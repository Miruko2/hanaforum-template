"use client"

import { useEffect, useState } from "react"

/**
 * Detects "mobile-class" devices that should run the music page in lite mode.
 *
 * Criteria: coarse pointer (= finger, not mouse) AND viewport ≤ 1024px.
 * This intentionally filters out:
 *   - desktops/laptops with mice (always full effect)
 *   - iPad Pro / large tablets (touch but big screen + enough GPU)
 * and catches:
 *   - phones (the actual target — small touch screens with weak GPUs)
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
    setMobile(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return mobile
}
