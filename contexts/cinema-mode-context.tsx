"use client"

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { useRouter, useSearchParams } from "next/navigation"

type CinemaModeCtx = {
  /** Current cinema-mode state (true = full-bleed cinema view). */
  cinemaMode: boolean
  /** Set explicitly. */
  setCinemaMode: (on: boolean) => void
  /** Toggle on/off. */
  toggleCinemaMode: () => void
}

const Ctx = createContext<CinemaModeCtx | null>(null)

export function useCinemaMode(): CinemaModeCtx {
  const v = useContext(Ctx)
  if (!v) {
    throw new Error("useCinemaMode must be used inside <CinemaModeProvider>")
  }
  return v
}

/**
 * Single source of truth for the "cinema mode" toggle that both the home page
 * and the top nav care about. Replaces a previous CustomEvent bus.
 *
 * Cinema mode is purely an in-session effect — it is NOT persisted, so a fresh
 * page load always lands in the default (off) state. The ?cinema=1 query
 * param is still consumed once on arrival so cross-page deep links work.
 */
/**
 * 把 useSearchParams() 的调用隔离到独立子组件 + Suspense 包裹，
 * 是 Next.js `output:'export'`（Capacitor 静态构建）下的硬要求。
 * 否则整个 Provider 包裹的所有页面在 build 阶段都会失败。
 */
function CinemaModeUrlSync({
  setCinemaModeState,
}: {
  setCinemaModeState: (on: boolean) => void
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Consume ?cinema=1 once, then strip it from the URL so refresh doesn't loop.
  useEffect(() => {
    if (searchParams?.get("cinema") !== "1") return
    setCinemaModeState(true)
    const params = new URLSearchParams(searchParams.toString())
    params.delete("cinema")
    const qs = params.toString()
    router.replace(qs ? `/?${qs}` : "/")
  }, [searchParams, router, setCinemaModeState])

  return null
}

export function CinemaModeProvider({ children }: { children: ReactNode }) {
  const [cinemaMode, setCinemaModeState] = useState(false)

  const setCinemaMode = useCallback((on: boolean) => {
    setCinemaModeState(on)
  }, [])

  const toggleCinemaMode = useCallback(() => {
    setCinemaModeState((prev) => !prev)
  }, [])

  return (
    <Ctx.Provider value={{ cinemaMode, setCinemaMode, toggleCinemaMode }}>
      <Suspense fallback={null}>
        <CinemaModeUrlSync setCinemaModeState={setCinemaModeState} />
      </Suspense>
      {children}
    </Ctx.Provider>
  )
}
