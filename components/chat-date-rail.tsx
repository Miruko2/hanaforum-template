"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { cnDateLabel, cnWeekday, type DateBucket } from "@/lib/cn-date"

// 聊天右缘的「点阵 LED 电平表」日期轨（与注册/验证弹窗的点阵数字同语言）。
//   · 每个有消息的日期一行点阵，亮点数 ∝ 当天条数（sqrt 压缩），右对齐生长；
//   · 点阵用 radial-gradient 背景画（每行仅底点+亮点两个 span，几百天也不堆 DOM）；
//   · 鼠标 hover：那一行（及邻近行渐次）放大 —— 仿 macOS dock 选中放大；
//   · 仅 hover 时弹出半透明纯黑圆角描述卡（日期/条数/周几），贴在被 hover 行左侧、箭头指向轨道；
//   · 触屏（移动端无 hover）：手指在轨道上拖动即实时「擦写」预览（放大 + 描述卡随指，
//     等同桌面 hover）—— 拖动只预览、不跳转；轻点某个点才跳到那天；日期多到一屏放不下时，
//     指尖触上/下边缘自动滚动；
//   · 当前阅读位置那天底点更亮一点当「你在这」标记；轨道自身可竖向滚动，日期多只滚不挤。
// 全程实色背景（无 backdrop-filter / blur），安卓安全。

const ROW_H = 14 // 每个日期占的行高（整行点击/hover 区）
const STEP = 6 // 点间距
const MAX_DOTS = 9 // 满量程点数
const DOT_BAND = 6 // 点阵带高度
const TRACK_W = MAX_DOTS * STEP // = 54，点阵实际宽度（右对齐）
const RAIL_W = 70 // 滚动条区宽：右 54 是点阵，左 16 留给放大向左生长不被裁
const CARD_W = 112
// 触屏擦写：指尖离轨道上/下边缘小于 EDGE px 时自动滚动；AUTO_MAX 为每帧最大滚动速度。
const EDGE = 26
const AUTO_MAX = 9
// 指尖位移小于它视作「轻点」（放行跳转），否则「拖动」（只预览、拦掉跳转）。
const TAP_SLOP = 8

const dotBg = (color: string) => `radial-gradient(circle, ${color} 1.7px, transparent 2.2px)`

// dock 放大倍率：被 hover 行最大，邻近行渐次衰减
function scaleFor(i: number, hover: number | null): number {
  if (hover == null) return 1
  const d = Math.abs(i - hover)
  return d === 0 ? 1.45 : d === 1 ? 1.25 : d === 2 ? 1.1 : 1
}

export default function ChatDateRail({
  dates,
  activeDate,
  onJump,
}: {
  dates: DateBucket[] // 新→旧
  activeDate: string | null
  onJump: (d: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const centeredRef = useRef(false)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [cardTop, setCardTop] = useState<number | null>(null)

  // ── 触屏「擦写」交互（桌面靠 hover，移动端靠拖动指尖）─────────────────────────
  // 指尖在轨道上拖动 → 实时高亮指下那行（放大 + 描述卡，视觉等同 hover）；抬指跳到该日。
  // 触屏下轨道 touch-action:none、禁原生滚动改由我们驱动；内容超长时指尖触边自动滚动。
  const scrubbingRef = useRef(false)
  // 刚有过触摸：短暂抑制浏览器补发的合成 mouseenter，免得 hover 卡片闪一下。
  const touchHandledRef = useRef(false)
  // 本次是「拖动」而非「轻点」：拖动只预览不跳，故拦掉它可能补发的 click。
  const suppressClickRef = useRef(false)
  const movedRef = useRef(false) // 指尖是否已移出 TAP_SLOP（区分轻点 vs 拖动）
  const startYRef = useRef(0) // 触摸起点 clientY（判定是否移动）
  const autoRafRef = useRef<number | null>(null)
  const autoVelRef = useRef(0) // 自动滚动速度（带符号；<0 上滚，>0 下滚）
  const lastYRef = useRef(0) // 最近触点 clientY（自动滚动每帧据此重算指下行）

  const maxCnt = useMemo(() => Math.max(1, ...dates.map((d) => d.cnt)), [dates])
  const activeIdx = useMemo(
    () => (activeDate ? dates.findIndex((b) => b.d === activeDate) : -1),
    [dates, activeDate],
  )
  const litOf = (cnt: number) => Math.max(1, Math.min(MAX_DOTS, Math.round(MAX_DOTS * Math.sqrt(cnt / maxCnt))))

  // 打开时把当前阅读位置那天滚到竖向居中（仅一次，不随阅读滚动反复抢位）
  useEffect(() => {
    if (centeredRef.current) return
    const el = scrollRef.current
    if (!el || activeIdx < 0) return
    el.scrollTop = activeIdx * ROW_H + ROW_H / 2 - el.clientHeight / 2
    centeredRef.current = true
  }, [activeIdx, dates.length])

  // 卸载时停掉自动滚动 rAF，避免泄漏
  useEffect(() => () => {
    if (autoRafRef.current != null) cancelAnimationFrame(autoRafRef.current)
  }, [])

  const onEnter = (i: number, e: React.MouseEvent<HTMLButtonElement>) => {
    // 触屏正在擦写 / 刚触摸跳转：忽略浏览器补发的 mouseenter，免得卡片闪一下
    if (scrubbingRef.current || touchHandledRef.current) return
    setHoverIdx(i)
    const sc = scrollRef.current
    if (!sc) return
    const rb = e.currentTarget.getBoundingClientRect()
    const cb = sc.getBoundingClientRect()
    setCardTop(Math.max(12, Math.min(cb.height - 12, rb.top - cb.top + rb.height / 2)))
  }

  if (dates.length < 2) return null

  const contentH = dates.length * ROW_H
  const bandTop = (ROW_H - DOT_BAND) / 2
  const hovered = hoverIdx != null ? dates[hoverIdx] : null

  // clientY → 轨道行索引（含当前 scrollTop，故内容滚动后仍指向指尖正下方那行）
  const idxFromY = (clientY: number) => {
    const sc = scrollRef.current
    if (!sc) return 0
    const cb = sc.getBoundingClientRect()
    const i = Math.floor((clientY - cb.top + sc.scrollTop) / ROW_H)
    return Math.max(0, Math.min(dates.length - 1, i))
  }

  // 据触点高亮指下行 + 把描述卡定位到指尖竖直位置
  const hoverFromY = (clientY: number) => {
    const sc = scrollRef.current
    if (!sc) return
    const cb = sc.getBoundingClientRect()
    setHoverIdx(idxFromY(clientY))
    setCardTop(Math.max(12, Math.min(cb.height - 12, clientY - cb.top)))
  }

  // 自动滚动一帧：滚一点 → 重算指下行；到底/到顶或松手即停。
  const tickAutoScroll = () => {
    const el = scrollRef.current
    if (!el || !scrubbingRef.current || autoVelRef.current === 0) {
      autoRafRef.current = null
      return
    }
    const max = el.scrollHeight - el.clientHeight
    el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + autoVelRef.current))
    hoverFromY(lastYRef.current)
    if ((autoVelRef.current < 0 && el.scrollTop <= 0) || (autoVelRef.current > 0 && el.scrollTop >= max)) {
      autoVelRef.current = 0
      autoRafRef.current = null
      return
    }
    autoRafRef.current = requestAnimationFrame(tickAutoScroll)
  }

  // 指尖靠近上/下边缘且仍有可滚内容 → 设定自动滚动速度并启动 rAF
  const updateAutoScroll = (clientY: number) => {
    const sc = scrollRef.current
    if (!sc) return
    const cb = sc.getBoundingClientRect()
    const max = sc.scrollHeight - sc.clientHeight
    let v = 0
    if (max > 0) {
      const dTop = clientY - cb.top
      const dBot = cb.bottom - clientY
      if (dTop < EDGE && sc.scrollTop > 0) v = -Math.ceil((1 - Math.max(0, dTop) / EDGE) * AUTO_MAX)
      else if (dBot < EDGE && sc.scrollTop < max) v = Math.ceil((1 - Math.max(0, dBot) / EDGE) * AUTO_MAX)
    }
    autoVelRef.current = v
    if (v !== 0 && autoRafRef.current == null) autoRafRef.current = requestAnimationFrame(tickAutoScroll)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    scrubbingRef.current = true
    movedRef.current = false
    startYRef.current = t.clientY
    lastYRef.current = t.clientY
    hoverFromY(t.clientY)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0]
    if (!t) return
    if (Math.abs(t.clientY - startYRef.current) > TAP_SLOP) movedRef.current = true
    lastYRef.current = t.clientY
    hoverFromY(t.clientY)
    updateAutoScroll(t.clientY)
  }
  // 结束手势：拖动擦写只收起预览、绝不跳转（拦掉可能补发的 click）；
  // 跳转交给「轻点」走原生 click（见按钮 onClick）。卡片留一拍作反馈再隐藏。
  const endScrub = () => {
    if (!scrubbingRef.current) return
    scrubbingRef.current = false
    autoVelRef.current = 0
    if (autoRafRef.current != null) {
      cancelAnimationFrame(autoRafRef.current)
      autoRafRef.current = null
    }
    // 抑制随后的合成 mouseenter（防 hover 卡片闪）
    touchHandledRef.current = true
    setTimeout(() => {
      touchHandledRef.current = false
    }, 500)
    // 拖动过 → 拦掉随后的合成 click（拖动只预览不跳）；轻点则放行 click 去跳转
    if (movedRef.current) {
      suppressClickRef.current = true
      setTimeout(() => {
        suppressClickRef.current = false
      }, 500)
    }
    setTimeout(() => {
      if (!scrubbingRef.current) setHoverIdx(null)
    }, 320)
  }

  return (
    <div className="pointer-events-none absolute right-1 top-3 bottom-3 z-20" style={{ width: RAIL_W }}>
      <div
        ref={scrollRef}
        onMouseLeave={() => setHoverIdx(null)}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={endScrub}
        onTouchCancel={endScrub}
        // 触屏下禁用原生滚动：垂直拖动改作「擦写」，超长内容靠 updateAutoScroll 滚动。
        // 桌面只用滚轮(wheel)，不受 touch-action 影响。
        style={{ touchAction: "none", WebkitUserSelect: "none", userSelect: "none" }}
        className="pointer-events-auto h-full overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="relative" style={{ height: contentH, width: RAIL_W }}>
          {dates.map((b, i) => {
            const isActive = i === activeIdx
            const lit = litOf(b.cnt)
            const s = scaleFor(i, hoverIdx)
            return (
              <button
                key={b.d}
                type="button"
                // 轻点跳转走这里的原生 click；拖动擦写时 suppressClickRef 拦掉，避免误跳
                onClick={() => {
                  if (suppressClickRef.current) return
                  onJump(b.d)
                }}
                onMouseEnter={(e) => onEnter(i, e)}
                title={`${cnDateLabel(b.d)} · ${b.cnt} 条`}
                aria-label={`跳到 ${cnDateLabel(b.d)}`}
                className="absolute left-0 transition-transform duration-150 ease-out"
                style={{
                  top: i * ROW_H,
                  width: RAIL_W,
                  height: ROW_H,
                  transform: `scale(${s})`,
                  transformOrigin: "right center",
                  zIndex: s > 1.3 ? 5 : s > 1 ? 3 : 1,
                }}
              >
                {/* 底点（全量程，暗；当前阅读位置那行更亮一点） */}
                <span
                  className="absolute right-0"
                  style={{
                    top: bandTop,
                    width: TRACK_W,
                    height: DOT_BAND,
                    backgroundImage: dotBg(isActive ? "rgba(182,255,58,0.32)" : "rgba(182,255,58,0.15)"),
                    backgroundSize: `${STEP}px ${STEP}px`,
                    backgroundRepeat: "repeat-x",
                    backgroundPosition: "right center",
                  }}
                />
                {/* 亮点（右对齐，长度=亮点数） */}
                <span
                  className="absolute right-0"
                  style={{
                    top: bandTop,
                    width: lit * STEP,
                    height: DOT_BAND,
                    backgroundImage: dotBg("#b6ff3a"),
                    backgroundSize: `${STEP}px ${STEP}px`,
                    backgroundRepeat: "repeat-x",
                    backgroundPosition: "right center",
                  }}
                />
              </button>
            )
          })}
        </div>
      </div>

      {/* 描述卡：仅 hover 时出现；半透明纯黑圆角，贴被 hover 行左侧，箭头指向轨道 */}
      {hovered && cardTop != null && (
        <div
          className="pointer-events-none absolute"
          style={{ right: RAIL_W + 8, top: cardTop, transform: "translateY(-50%)", width: CARD_W }}
        >
          <div className="relative">
            <div
              style={{
                background: "rgba(0,0,0,0.62)",
                border: "1px solid rgba(255,255,255,0.10)",
                borderRadius: 10,
                padding: "6px 11px",
              }}
            >
              <div style={{ color: "#f4f4f7", fontSize: 13, fontWeight: 500, lineHeight: 1.2 }}>
                {cnDateLabel(hovered.d)}
              </div>
              <div style={{ color: "#a9a6bd", fontSize: 11, marginTop: 2 }}>
                {hovered.cnt} 条 · {cnWeekday(hovered.d)}
              </div>
            </div>
            <span
              className="absolute"
              style={{
                right: -4,
                top: "50%",
                width: 9,
                height: 9,
                background: "rgba(0,0,0,0.62)",
                borderRadius: 2,
                transform: "translateY(-50%) rotate(45deg)",
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
