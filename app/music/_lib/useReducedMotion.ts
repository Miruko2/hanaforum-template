"use client"

import { useEffect, useState } from "react"

/**
 * Returns true when the user has expressed a preference for reduced motion
 * at the OS level (e.g. macOS "Reduce motion", Windows "Show animations").
 *
 * We treat this as an honest signal that the user either has motion
 * sensitivity OR is on a device that struggles to render the full effect —
 * either way, scaling back ambient motion is the right call.
 *
 * Watches the media query live; flips back if the user changes the setting.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return reduced
}
