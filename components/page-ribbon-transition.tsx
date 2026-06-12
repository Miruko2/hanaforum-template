"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { usePathname, useRouter } from "next/navigation"
import { useCinemaMode } from "@/contexts/cinema-mode-context"
import {
  CINEMA_RING_PATH,
  registerRibbonNavigator,
  waitForRouteCommit,
  type FlipDirection,
} from "@/lib/view-transition-nav"

// 二次元游戏风转场（绝区零式 MG 遮罩）：覆盖 → 换页 → 揭开。
// 三层斜切色块交错扫屏（粉 → 白 → 黑主板），主板上巨型镂空描边文字
// 交错方向滚动、网点纹理、速度线横飞、标题卡弹入。
// 样式见 globals.css 的 .ptr-* 段。
// 全程仅 transform/opacity 动画，安卓 WebView 安全。

// 时序常量（ms）。三层扫屏 = 单层 0.28s + 0.06s 级联延迟，
// 改动须与 globals.css 的 ptr-wipe-in/out 时长和 delay 同步。
const COVER_MS = 400 // 最后一层（黑主板）完全遮蔽屏幕
const MIN_HOLD_MS = 360 // 满屏后最短停留（标题卡弹入需要露脸时间）
const REVEAL_MS = 400 // 三层依次扫出
const COMMIT_TIMEOUT_MS = 800 // 路由 commit 兜底

// 每页文案：英文名 + 日文 + 中文 + 编号 + 水印符号
interface RibbonCard {
  word: string
  jp: string
  cn: string
  no: string
  mark: string
}

const CARDS: Record<string, RibbonCard> = {
  "/": { word: "HOME", jp: "ホーム", cn: "首页", no: "01", mark: "◇" },
  "/live": { word: "DANMAKU", jp: "弾幕の壁", cn: "弹幕墙", no: "02", mark: "△" },
  [CINEMA_RING_PATH]: { word: "CINEMA", jp: "シアター", cn: "影院模式", no: "03", mark: "▶" },
  "/profile": { word: "PROFILE", jp: "プロフィール", cn: "个人中心", no: "04", mark: "○" },
  // music 在滑动环外（导航栏点击仍走转场），编号用 EX 表示番外位
  "/music": { word: "MUSIC", jp: "音楽", cn: "音乐", no: "EX", mark: "♪" },
}

const FALLBACK_CARD: RibbonCard = { word: "HANA", jp: "ホタル", cn: "萤火虫", no: "??", mark: "✦" }

// 主板上的巨型文字行数与速度线条数（布局/配色见 globals.css 的 .ptr-row-N / .ptr-streak-N）
const ROW_COUNT = 6
const STREAK_COUNT = 6

interface ActiveState {
  dir: FlipDirection
  phase: "cover" | "reveal"
  card: RibbonCard
}

export default function PageRibbonTransition() {
  const router = useRouter()
  const pathname = usePathname()
  const { setCinemaMode } = useCinemaMode()
  const [active, setActive] = useState<ActiveState | null>(null)
  // 转场进行中锁：动画期间忽略重复触发（覆盖层本身也拦截一切指针事件）
  const runningRef = useRef(false)
  const timersRef = useRef<number[]>([])
  const routerRef = useRef(router)
  routerRef.current = router
  const pathRef = useRef(pathname)
  pathRef.current = pathname

  const start = useCallback((href: string, dir: FlipDirection) => {
    if (runningRef.current) return
    runningRef.current = true
    setActive({ dir, phase: "cover", card: CARDS[href] ?? FALLBACK_CARD })

    const coverTimer = window.setTimeout(() => {
      // 满屏瞬间换页；揭开要等「路由 commit + 最短停留」二者齐备。
      // "/cinema" 是虚拟环位 = 首页 + 影院模式；去首页则显式关影院。
      // 已在首页时进出影院没有路由变化，跳过 commit 等待（否则白等 800ms 超时），
      // 视图切换由 React 状态驱动，MIN_HOLD + 双 rAF 足以覆盖首绘。
      const wantCinema = href === CINEMA_RING_PATH
      const targetPath = wantCinema ? "/" : href
      const sameRoute = targetPath === pathRef.current
      const committed = sameRoute ? Promise.resolve() : waitForRouteCommit(COMMIT_TIMEOUT_MS)
      const held = new Promise<void>((resolve) => {
        timersRef.current.push(window.setTimeout(resolve, MIN_HOLD_MS))
      })
      if (wantCinema) setCinemaMode(true)
      else if (targetPath === "/") setCinemaMode(false)
      if (!sameRoute) routerRef.current.push(targetPath)
      void Promise.all([committed, held]).then(() => {
        // 再等两帧，让新页面在遮罩后完成首绘，避免揭开时露出未绘制的底
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setActive((cur) => (cur ? { ...cur, phase: "reveal" } : cur))
            timersRef.current.push(
              window.setTimeout(() => {
                setActive(null)
                runningRef.current = false
              }, REVEAL_MS + 80),
            )
          }),
        )
      })
    }, COVER_MS)
    timersRef.current.push(coverTimer)
  }, [setCinemaMode])

  useEffect(() => {
    const unregister = registerRibbonNavigator(start)
    const timers = timersRef.current
    return () => {
      unregister()
      timers.forEach((t) => clearTimeout(t))
    }
  }, [start])

  if (!active) return null

  const { card, dir, phase } = active
  // 小字行滚完整短语，大字行只滚「单词 + 符号」。repeat 足够长保证宽屏下不滚穿
  const phrase = `${card.word}  ${card.mark}  ${card.jp}  •  ${card.word}  ${card.mark}  ${card.cn}  •  `.repeat(14)
  const bigPhrase = `${card.word}  ${card.mark}  `.repeat(12)

  return createPortal(
    <div
      className="ptr-root"
      data-phase={phase}
      // --ptr-x：1 = 去环上下一页（从右扫入、向左扫出），-1 反向
      style={{ "--ptr-x": dir === "next" ? 1 : -1 } as CSSProperties}
      aria-hidden
    >
      {/* 三层交错扫屏：DOM 顺序即叠放顺序（粉底层 → 白中层 → 黑主板顶层） */}
      <div className="ptr-wipe ptr-wipe-a">
        <div className="ptr-wipe-fill" />
      </div>
      <div className="ptr-wipe ptr-wipe-b">
        <div className="ptr-wipe-fill" />
      </div>
      <div className="ptr-wipe ptr-wipe-main">
        <div className="ptr-panel">
          <div className="ptr-halftone" />
          <div className="ptr-rows">
            {Array.from({ length: ROW_COUNT }, (_, i) => i + 1).map((n) => (
              <div key={n} className={`ptr-row ptr-row-${n}`}>
                <span>{n % 2 === 1 ? bigPhrase : phrase}</span>
              </div>
            ))}
          </div>
          <div className="ptr-scanlines" />
        </div>
        {/* 以下元素不进 panel：避开 skew，直接乘主板的平移 */}
        <div className="ptr-mark">{card.mark}</div>
        <div className="ptr-title">
          <div className="ptr-title-word">
            <span className="ptr-title-echo">{card.word}</span>
            <span className="ptr-title-main">{card.word}</span>
          </div>
          <div className="ptr-title-chip">
            <span>{card.jp}</span>
            <i />
            <span>{card.cn}</span>
          </div>
        </div>
        <div className="ptr-corner-no">
          {card.no}
          {card.no !== "EX" && <em>/ 04</em>}
        </div>
        <div className="ptr-corner-loading">NOW LOADING ▸▸▸</div>
        <div className="ptr-edge ptr-edge-left" />
        <div className="ptr-edge ptr-edge-right" />
      </div>
      {/* 速度线：压在一切之上横飞 */}
      <div className="ptr-streaks">
        {Array.from({ length: STREAK_COUNT }, (_, i) => i + 1).map((n) => (
          <span key={n} className={`ptr-streak ptr-streak-${n}`} />
        ))}
      </div>
      {/* 满屏瞬间的冲击闪光（低透明度，挂载后只跑一次） */}
      <div className="ptr-flash" />
    </div>,
    document.body,
  )
}
