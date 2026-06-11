"use client"

import { useEffect, useRef, useState } from "react"

/**
 * ?perf 性能测量浮层（仅 music 页挂载）。
 *
 * 背景：没有低配安卓测试机，卡顿优化必须先有客观数字、不能盲改。
 * 在任意设备访问 /music?perf 即显示实时指标，半秒刷新一次：
 *   `58 fps · avg 17.1ms · max 42ms · 掉帧 3%`
 *   - fps   —— 实际渲染帧率（高刷屏会显示 90/120）
 *   - avg   —— 窗口内平均帧时
 *   - max   —— 窗口内最差单帧（卡顿尖刺）
 *   - 掉帧  —— 帧时 >33.4ms（60Hz 连丢 2 帧以上）的比例
 *
 * 成本控制：不带 ?perf 时 mount 后即返 null、不跑任何循环；开启时也只在
 * rAF 里做几次加法，每 500ms 才写一次 textContent（不走 React state）。
 * 真机用法：安卓 Chrome 直接访问 /music?perf；app 内可配合 chrome://inspect。
 */
export function PerfHUD() {
  const [enabled, setEnabled] = useState(false)
  const elRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      setEnabled(new URLSearchParams(window.location.search).has("perf"))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let mounted = true
    let raf = 0
    let last = performance.now()
    let frames = 0
    let total = 0
    let worst = 0
    let jank = 0
    let windowStart = last

    const loop = (now: number) => {
      if (!mounted) return
      const dt = now - last
      last = now
      // 标签页切走再回来 rAF 会停摆，巨大的 dt 不是真实帧时 —— 丢弃并重开窗口。
      if (dt > 1000) {
        frames = 0
        total = 0
        worst = 0
        jank = 0
        windowStart = now
        raf = requestAnimationFrame(loop)
        return
      }
      frames++
      total += dt
      if (dt > worst) worst = dt
      if (dt > 33.4) jank++
      if (now - windowStart >= 500) {
        const fps = (frames * 1000) / (now - windowStart)
        const avg = total / frames
        if (elRef.current) {
          elRef.current.textContent =
            `${fps.toFixed(0)} fps · avg ${avg.toFixed(1)}ms · max ${worst.toFixed(0)}ms · 掉帧 ${((jank / frames) * 100).toFixed(0)}%`
        }
        frames = 0
        total = 0
        worst = 0
        jank = 0
        windowStart = now
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      mounted = false
      cancelAnimationFrame(raf)
    }
  }, [enabled])

  if (!enabled) return null
  return (
    <div
      ref={elRef}
      className="pointer-events-none fixed top-16 left-4 z-[70] rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] tabular-nums text-lime-300"
    >
      测量中…
    </div>
  )
}
