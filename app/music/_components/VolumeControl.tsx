"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import { Volume2, Volume1, VolumeX } from "lucide-react"

// 底部弹层里的细滑条尺寸
const POP_W = 44
const TRACK_H = 110

// 右侧「音量胶囊」HUD 尺寸（仿手机系统音量条）
const CAP_W = 50
const CAP_H = 156
// HUD 喇叭图标：两份重合，靠填充层 overflow 裁切实现「水位反色」
const ICON_SIZE = 20
const ICON_BOX = 30
const ICON_BOTTOM = 12

// 停止调节后 HUD 多久淡出（ms）
const HUD_LINGER = 1000

/**
 * 底部播放器的音量控件，由两部分组成：
 *  1) 喇叭按钮 + 点击展开的细滑条弹层（精确拖动 / 滚轮调节）。
 *  2) 右侧「音量胶囊」HUD：一调音量就从屏幕右侧滑入、实时随水位变化，
 *     停手约 1s 后自动滑出——仿手机系统按音量键的反馈条。
 *
 * 复用 PlayModeMenu 的「portal 到 body + 全屏透明遮罩兜底关闭」模式，
 * 避开播放器面板的 overflow-hidden 裁切与 backdrop-filter 层叠陷阱。
 * HUD 喇叭图标始终为白色，用「双图标拼接」实现：底层一份 + 填充层内一份，
 * 后者补齐被水位填充盖住的下半、避免图标被截断；不用 mix-blend-mode
 * （规避 Android WebView 的 blend 兼容 / 性能问题）。
 */
export function VolumeControl({
  volume,
  setVolume,
  hue,
}: {
  volume: number
  setVolume: (v: number) => void
  hue: number
}) {
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  // 镜像最新音量，供原生 wheel 监听读取（稳定引用，不入依赖反复重绑）。
  const volumeRef = useRef(volume)
  const hudTimerRef = useRef<number | null>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ bottom: number; left: number } | null>(null)
  const [hudOpen, setHudOpen] = useState(false)

  // 同步音量镜像（供 wheel 监听读取最新值）。
  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  // 触发 / 续命 HUD：显示并重置淡出定时器。
  const pingHud = useCallback(() => {
    setHudOpen(true)
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current)
    hudTimerRef.current = window.setTimeout(() => setHudOpen(false), HUD_LINGER)
  }, [])

  // 用户调音量统一入口：写入音量 + 弹出 HUD。初始化（localStorage 读取）走的是
  // context 内部 setState、不经此处，故页面加载不会误弹 HUD。
  const changeVolume = useCallback(
    (v: number) => {
      setVolume(v)
      pingHud()
    },
    [setVolume, pingHud],
  )

  // 卸载时清掉 HUD 定时器。
  useEffect(() => {
    return () => {
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current)
    }
  }, [])

  // 弹层定位：锚到喇叭按钮正上方，水平居中并夹到视口内（随 resize 更新）。
  useEffect(() => {
    if (!open) return
    const anchor = btnRef.current
    if (!anchor) return
    const update = () => {
      const r = anchor.getBoundingClientRect()
      let left = r.left + r.width / 2 - POP_W / 2
      left = Math.max(8, Math.min(left, window.innerWidth - POP_W - 8))
      setPos({ bottom: window.innerHeight - r.top + 10, left })
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [open])

  // 滚轮调音量：上滚 +10%、下滚 -10%。必须用原生「非 passive」监听，才能
  // preventDefault 阻止页面/卡片墙跟着滚；stopPropagation 防止冒泡到
  // MusicCanvas 的 wheel 处理。依赖 pos：弹层挂载后才绑得到元素。
  useEffect(() => {
    if (!open) return
    const el = trackRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      changeVolume(volumeRef.current + (e.deltaY < 0 ? 0.1 : -0.1)) // setVolume 内部已夹取 [0,1]
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [open, pos, changeVolume])

  // 由指针纵坐标换算音量：顶端 = 1，底端 = 0。
  const computeFromY = useCallback(
    (clientY: number): number => {
      const el = trackRef.current
      if (!el) return volume
      const r = el.getBoundingClientRect()
      if (r.height < 1) return volume
      const pct = 1 - (clientY - r.top) / r.height
      return Math.max(0, Math.min(1, pct))
    },
    [volume],
  )

  const onDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
      draggingRef.current = true
      changeVolume(computeFromY(e.clientY))
    },
    [computeFromY, changeVolume],
  )
  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      changeVolume(computeFromY(e.clientY))
    },
    [computeFromY, changeVolume],
  )
  const onUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return
    ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
    draggingRef.current = false
  }, [])

  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="音量"
        title="音量"
        className="h-8 w-8 grid place-items-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <Icon size={15} />
      </button>

      {/* 底部弹层：点击喇叭展开的细滑条（精确拖动 / 滚轮） */}
      {open &&
        pos &&
        createPortal(
          <>
            {/* 全屏透明遮罩：点击外部关闭，并吞掉指针避免误触发播放器展开 */}
            <div
              className="fixed inset-0 z-[68]"
              onClick={() => setOpen(false)}
              onPointerDown={(e) => e.stopPropagation()}
            />
            <motion.div
              className="fixed z-[69] flex flex-col items-center overflow-hidden rounded-2xl px-1 py-2 text-white"
              style={{
                bottom: pos.bottom,
                left: pos.left,
                width: POP_W,
                transformOrigin: "bottom center",
                background: "rgba(255,255,255,0.08)",
                backdropFilter: "blur(32px) saturate(160%)",
                WebkitBackdropFilter: "blur(32px) saturate(160%)",
                boxShadow:
                  "0 16px 48px -8px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.12)",
              }}
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.18, ease: [0.2, 0.9, 0.3, 1] }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* 竖向细滑条：外层 w-7 扩大触控命中区，内层细条仅作视觉 */}
              <div
                ref={trackRef}
                className="relative flex w-7 cursor-pointer touch-none justify-center"
                style={{ height: TRACK_H }}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              >
                <div className="relative h-full w-2.5 rounded-full bg-white/15">
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-full"
                    style={{
                      height: `${volume * 100}%`,
                      background: `linear-gradient(0deg, hsl(${hue} 75% 65%), hsl(${
                        (hue + 30) % 360
                      } 80% 70%))`,
                    }}
                  />
                  <div
                    className="absolute left-1/2 h-3.5 w-3.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-md"
                    style={{ bottom: `${volume * 100}%` }}
                  />
                </div>
              </div>
            </motion.div>
          </>,
          document.body,
        )}

      {/* 右侧「音量胶囊」HUD：调音量时滑入、实时随水位变化，停手后淡出 */}
      {createPortal(
        <AnimatePresence>
          {hudOpen && (
            <motion.div
              key="vol-hud"
              className="pointer-events-none fixed right-4 top-1/2 z-[69] overflow-hidden rounded-full"
              style={{
                width: CAP_W,
                height: CAP_H,
                background: "rgba(255,255,255,0.10)",
                backdropFilter: "blur(32px) saturate(160%)",
                WebkitBackdropFilter: "blur(32px) saturate(160%)",
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

              {/* 水位填充：矩形（顶部水位线平直，底部圆角由胶囊裁出），盖住水位内区域。
                  内含同款白色图标，补齐被填充盖住的下半，与底层白图标拼成完整图标，
                  避免图标下半被水位填充截断。 */}
              <div
                className="absolute inset-x-0 bottom-0 overflow-hidden"
                style={{
                  height: `${volume * 100}%`,
                  background: `linear-gradient(0deg, hsl(${hue} 85% 68%), hsl(${
                    (hue + 30) % 360
                  } 90% 78%))`,
                }}
              >
                <div
                  className="absolute inset-x-0 grid place-items-center text-white"
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
      )}
    </>
  )
}
