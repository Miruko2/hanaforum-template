"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { usePathname, useRouter } from "next/navigation"
import { useCinemaMode } from "@/contexts/cinema-mode-context"
import {
  CINEMA_RING_PATH,
  isAndroidRuntime,
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
//
// 关键：换页/卸载由黑主板的 animationend 驱动，而不是定时器。
// 主线程繁忙（连续快滑、新页面水合中）时 CSS 动画会比 JS 定时器晚开跑，
// 定时器准点换页会在屏幕没遮严时露出换页瞬间 → 概率性闪屏（安卓最明显）。
// 定时器只做 animationend 丢失（切后台等）的兜底。
const COVER_MS = 400 // 理论覆盖时长（黑主板 0.12s delay + 0.28s）
const COVER_FALLBACK_MS = COVER_MS + 500
const MIN_HOLD_MS = 360 // 满屏后最短停留（标题卡弹入需要露脸时间）
const REVEAL_MS = 400 // 三层依次扫出
const REVEAL_FALLBACK_MS = REVEAL_MS + 500
// 路由 commit 兜底。低端安卓上重页面 commit 可超 1s，放宽避免
// 揭开时露出"换到一半"的旧页面；遮罩上动画常驻，多停留不显卡死
const COMMIT_TIMEOUT_MS = 1500
// 转场结束后的冷却：连续快滑时给新页面水合 / GPU 纹理回收留喘息，
// 冷却期内的滑动静默忽略（比排队叠加恶化要好）。
// 安卓 WebView 合成器回收慢，冷却拉长，避免上一程图层未释放就叠下一程 → 鬼影/卡顿。
const COOLDOWN_MS = isAndroidRuntime ? 480 : 260

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
  // 安卓专用：装饰内容（巨型文字行/标题/网点/边条）推迟一帧再挂载。
  // 非安卓恒为 true（同步渲染，零延迟）。详见下方 showDecor 注释。
  const [decorReady, setDecorReady] = useState(false)
  // 转场进行中锁：动画 + 冷却期间忽略重复触发（覆盖层本身也拦截一切指针事件）
  const runningRef = useRef(false)
  // 各阶段只执行一次（animationend 与兜底定时器谁先到谁推进）
  const coveredRef = useRef(false)
  const revealedRef = useRef(false)
  // 转场代际：兜底定时器可能比「动画正常结束 + 冷却」更晚触发，
  // 过期定时器若打进下一次转场会把新覆盖层中途卸载，按代际作废
  const genRef = useRef(0)
  const hrefRef = useRef("")
  const timersRef = useRef<number[]>([])
  const routerRef = useRef(router)
  routerRef.current = router
  const pathRef = useRef(pathname)
  pathRef.current = pathname

  // 揭开收尾：卸载覆盖层，短冷却后才接受下一次转场
  const finishReveal = useCallback(() => {
    if (revealedRef.current || !runningRef.current) return
    revealedRef.current = true
    setActive(null)
    timersRef.current.push(
      window.setTimeout(() => {
        runningRef.current = false
      }, COOLDOWN_MS),
    )
  }, [])

  // 满屏后：换页 → 等「路由 commit + 最短停留」→ 双 rAF 等首绘 → 进入揭开
  const proceedCover = useCallback(() => {
    if (coveredRef.current || !runningRef.current) return
    coveredRef.current = true
    const href = hrefRef.current
    // "/cinema" 是虚拟环位 = 首页 + 影院模式；去首页则显式关影院。
    // 已在首页时进出影院没有路由变化，跳过 commit 等待（否则白等超时），
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
    const gen = genRef.current
    void Promise.all([committed, held]).then(() => {
      // 再等两帧，让新页面在遮罩后完成首绘，避免揭开时露出未绘制的底
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setActive((cur) => (cur ? { ...cur, phase: "reveal" } : cur))
          timersRef.current.push(
            window.setTimeout(() => {
              if (gen === genRef.current) finishReveal()
            }, REVEAL_FALLBACK_MS),
          )
        }),
      )
    })
  }, [setCinemaMode, finishReveal])

  const start = useCallback(
    (href: string, dir: FlipDirection) => {
      if (runningRef.current) return
      runningRef.current = true
      coveredRef.current = false
      revealedRef.current = false
      hrefRef.current = href
      const gen = ++genRef.current
      // 安卓先把装饰压住，和 setActive 同批提交 → 遮罩首帧只挂 3 层扫屏（轻），
      // 装饰交给下方 effect 推迟一帧再上，避开起手帧的布局/光栅化高峰
      if (isAndroidRuntime) setDecorReady(false)
      setActive({ dir, phase: "cover", card: CARDS[href] ?? FALLBACK_CARD })
      timersRef.current.push(
        window.setTimeout(() => {
          if (gen === genRef.current) proceedCover()
        }, COVER_FALLBACK_MS),
      )
    },
    [proceedCover],
  )

  useEffect(() => {
    const unregister = registerRibbonNavigator(start)
    const timers = timersRef.current
    return () => {
      unregister()
      timers.forEach((t) => clearTimeout(t))
    }
  }, [start])

  // 安卓：遮罩挂载（扫屏起手）后再过两帧才放装饰内容。
  // 扫屏 translateX 走合成线程，不被主线程的装饰布局/光栅化阻塞 → 起手帧顺滑；
  // 黑板 0.4s 才盖严、标题本就有 0.34s 入场延迟，晚 ~32ms 上肉眼无感。
  useEffect(() => {
    if (!active || !isAndroidRuntime) return
    let r2 = 0
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setDecorReady(true))
    })
    return () => {
      cancelAnimationFrame(r1)
      if (r2) cancelAnimationFrame(r2)
    }
  }, [active])

  if (!active) return null

  const { card, dir, phase } = active
  // 装饰是否可挂载：非安卓恒真（同步渲染）；安卓等首帧扫屏起手后两帧才放，
  // 把巨型文字行的布局/光栅化挪离起手帧，换取扫屏滑动的丝滑起手。
  const showDecor = !isAndroidRuntime || decorReady
  // 小字行滚完整短语，大字行只滚「单词 + 符号」。
  // 转场存活 <1.3s，滚动跑不完一圈，只需够铺满首屏 + 这点位移即可，
  // 故安卓用较短重复串（省布局开销），非安卓保留长串防宽屏滚穿。
  const phraseRepeat = isAndroidRuntime ? 6 : 14
  const bigRepeat = isAndroidRuntime ? 3 : 12
  const phrase = `${card.word}  ${card.mark}  ${card.jp}  •  ${card.word}  ${card.mark}  ${card.cn}  •  `.repeat(phraseRepeat)
  const bigPhrase = `${card.word}  ${card.mark}  `.repeat(bigRepeat)

  return createPortal(
    <div
      className={`ptr-root${isAndroidRuntime ? " ptr-android" : ""}`}
      data-phase={phase}
      // --ptr-x：1 = 去环上下一页（从右扫入、向左扫出），-1 反向
      style={{ "--ptr-x": dir === "next" ? 1 : -1 } as CSSProperties}
      aria-hidden
    >
      {/* 三层交错扫屏：DOM 顺序即叠放顺序（粉底层 → 白中层 → 黑主板顶层）。
          粉层扫出最晚结束（0.12s delay）= 整组揭开完成 */}
      <div
        className="ptr-wipe ptr-wipe-a"
        onAnimationEnd={(e) => {
          if (e.animationName === "ptr-wipe-out") finishReveal()
        }}
      >
        <div className="ptr-wipe-fill" />
      </div>
      <div className="ptr-wipe ptr-wipe-b">
        <div className="ptr-wipe-fill" />
      </div>
      {/* 黑主板扫入最晚结束（0.12s delay）= 屏幕真正遮严，此刻才换页。
          子元素动画（标题弹入等）会冒泡上来，按 animationName 过滤 */}
      <div
        className="ptr-wipe ptr-wipe-main"
        onAnimationEnd={(e) => {
          if (e.animationName === "ptr-wipe-in") proceedCover()
        }}
      >
        <div className="ptr-panel">
          {showDecor && (
            <>
              <div className="ptr-halftone" />
              <div className="ptr-rows">
                {Array.from({ length: ROW_COUNT }, (_, i) => i + 1).map((n) => (
                  <div key={n} className={`ptr-row ptr-row-${n}`}>
                    <span>{n % 2 === 1 ? bigPhrase : phrase}</span>
                  </div>
                ))}
              </div>
              <div className="ptr-scanlines" />
            </>
          )}
        </div>
        {/* 以下元素不进 panel：避开 skew，直接乘主板的平移 */}
        {showDecor && (
          <>
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
          </>
        )}
      </div>
      {/* 速度线：压在一切之上横飞。
          安卓上这是常驻无限动画的重灾区（6 条独立合成图层持续光栅化），
          连续快滑时最易引发鬼影/卡顿，故安卓精简渲染时整组不挂载。 */}
      {!isAndroidRuntime && (
        <div className="ptr-streaks">
          {Array.from({ length: STREAK_COUNT }, (_, i) => i + 1).map((n) => (
            <span key={n} className={`ptr-streak ptr-streak-${n}`} />
          ))}
        </div>
      )}
      {/* 满屏瞬间的冲击闪光（低透明度，挂载后只跑一次） */}
      <div className="ptr-flash" />
    </div>,
    document.body,
  )
}
