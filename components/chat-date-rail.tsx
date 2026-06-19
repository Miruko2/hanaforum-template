"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { cnDateLabel, cnWeekday, type DateBucket } from "@/lib/cn-date"

// 聊天右缘的「点阵 LED 电平表」日期轨（与注册/验证弹窗的点阵数字同语言）。
//   · 每个有消息的日期一行点阵，亮点数 ∝ 当天条数（sqrt 压缩），右对齐生长；
//   · 点阵用 radial-gradient 背景画（每行仅底点+亮点两个 span，几百天也不堆 DOM）；
//   · 鼠标 hover：那一行（及邻近行渐次）放大 —— 仿 macOS dock 选中放大；
//   · 仅 hover 时弹出半透明纯黑圆角描述卡（日期/条数/周几），贴在被 hover 行左侧、箭头指向轨道；
//   · 当前阅读位置那天底点更亮一点当「你在这」标记；轨道自身可竖向滚动，日期多只滚不挤。
// 全程实色背景（无 backdrop-filter / blur），安卓安全。

const ROW_H = 14 // 每个日期占的行高（整行点击/hover 区）
const STEP = 6 // 点间距
const MAX_DOTS = 9 // 满量程点数
const DOT_BAND = 6 // 点阵带高度
const TRACK_W = MAX_DOTS * STEP // = 54，点阵实际宽度（右对齐）
const RAIL_W = 70 // 滚动条区宽：右 54 是点阵，左 16 留给放大向左生长不被裁
const CARD_W = 112

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

  const onEnter = (i: number, e: React.MouseEvent<HTMLButtonElement>) => {
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

  return (
    <div className="pointer-events-none absolute right-1 top-3 bottom-3 z-20" style={{ width: RAIL_W }}>
      <div
        ref={scrollRef}
        onMouseLeave={() => setHoverIdx(null)}
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
                onClick={() => onJump(b.d)}
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
