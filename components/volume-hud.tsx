"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Volume2, Volume1, VolumeX } from "lucide-react"

const CAP_W = 50
const CAP_H = 156
const ICON_SIZE = 20
const ICON_BOX = 30
const ICON_BOTTOM = 12
const HUD_LINGER = 1000

/**
 * 全局「系统音量胶囊」HUD —— 仅安卓 App 内生效。
 *
 * 监听原生 MainActivity 通过 Capacitor bridge 发来的 "volumebuttons" 事件
 * （用户按机身音量键 → 原生调系统媒体音量并附带新音量百分比）。收到后从屏幕
 * 右侧滑入、按水位显示系统音量，停手约 1s 淡出——把系统自带的丑音量条替换成
 * 与播放器一致的玻璃胶囊（仿 iOS 系统音量条：白色水位 + 反色喇叭图标）。
 *
 * 网页版（非 App）收不到该事件，组件始终静默不渲染、零副作用。
 * 反色图标用「双图标 + 填充层 overflow 裁切」实现，不用 mix-blend-mode
 * （规避 Android WebView 的 blend 兼容 / 性能问题）。
 */
export function VolumeHud() {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [volume, setVolume] = useState(1)
  const timerRef = useRef<number | null>(null)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const onVol = (e: Event) => {
      const detail = (e as CustomEvent).detail
      let v = 1
      try {
        const data = typeof detail === "string" ? JSON.parse(detail) : detail
        if (data && typeof data.volume === "number") v = data.volume
      } catch {
        /* 解析失败保持默认，不影响显示 */
      }
      setVolume(Math.max(0, Math.min(1, v)))
      setOpen(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setOpen(false), HUD_LINGER)
    }
    window.addEventListener("volumebuttons", onVol)
    return () => {
      window.removeEventListener("volumebuttons", onVol)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  if (!mounted) return null

  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="sys-vol-hud"
          className="pointer-events-none fixed right-4 top-1/2 z-[9999] overflow-hidden rounded-full"
          style={{
            width: CAP_W,
            height: CAP_H,
            // 仅安卓 App 内显示：用实底背景、不上 backdrop-filter，规避 WebView 毛玻璃鬼影
            background: "rgba(28,28,32,0.94)",
            boxShadow:
              "0 16px 48px -8px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.16), inset 0 1px 0 rgba(255,255,255,0.14)",
          }}
          initial={{ opacity: 0, x: 44, y: "-50%" }}
          animate={{ opacity: 1, x: 0, y: "-50%" }}
          exit={{ opacity: 0, x: 44, y: "-50%" }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
        >
          {/* 底层喇叭图标（白色）：露在水位之上的部分由它显示 */}
          <div
            className="absolute inset-x-0 grid place-items-center text-white"
            style={{ bottom: ICON_BOTTOM, height: ICON_BOX }}
          >
            <Icon size={ICON_SIZE} />
          </div>

          {/* 水位填充（白色）：盖住水位内区域；内含深色反色图标补齐下半 */}
          <div
            className="absolute inset-x-0 bottom-0 overflow-hidden"
            style={{ height: `${volume * 100}%`, background: "rgba(255,255,255,0.92)" }}
          >
            <div
              className="absolute inset-x-0 grid place-items-center text-slate-900"
              style={{ bottom: ICON_BOTTOM, height: ICON_BOX }}
            >
              <Icon size={ICON_SIZE} />
            </div>
          </div>

          {/* 顶部把手（装饰） */}
          <div className="absolute left-1/2 top-2 h-1 w-4 -translate-x-1/2 rounded-full bg-white/45" />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
