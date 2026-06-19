"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"

// 背景图「高斯模糊渐入」交叉淡入的共享渲染层（首页 AppBackground 与 music ImageBackdrop 同款）。
// 把目标图 url 渲染成铺满父级的 <img> 层，切换时新图从 模糊 + 透明 + 轻微放大 过渡到
// 清晰 + 不透明，盖住旧图、结束丢弃旧层；url 变 null 时旧层模糊淡出后移除。
//   · baseUrl：可选，始终垫底的默认图。music 用（它身后是黑的、必须自带底图）；
//     首页不传——靠 layout 的默认底图垫底，未设自定义图时本组件渲染空。
//   · extraFilter：叠加在 blur 之外的常驻滤镜（如 music 的 saturate(1.08)）。
// 父级须是定位上下文（relative/absolute/fixed）且自管 z-index / overflow:hidden。
// 用 <img>：onLoad 保证「加载完才渐入」（不渐入半截/破图）、onError 丢弃失败层。
// blur 态配 scale(1.06) 过扫，避免高斯模糊采样到图外露出透明边。动画是一次性有限过渡
//（仅切换时），稳定后 filter 归 none / 无 transition，零常驻开销。

type Layer = { url: string; id: number; shown: boolean }

const COVER: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  objectPosition: "center",
}

export function CrossfadeBackground({
  url,
  baseUrl,
  extraFilter = "",
}: {
  url: string | null
  baseUrl?: string
  extraFilter?: string
}) {
  const [layers, setLayers] = useState<Layer[]>([])
  const idRef = useRef(0)

  useEffect(() => {
    if (!url) {
      // 还原默认：所有层标记淡出（动画结束在 onTransitionEnd 移除）
      setLayers((cur) => (cur.length === 0 ? cur : cur.map((l) => ({ ...l, shown: false }))))
      return
    }
    setLayers((cur) => {
      const top = cur[cur.length - 1]
      if (top && top.url === url) return cur // 没变
      idRef.current += 1
      return [...cur, { url, id: idRef.current, shown: false }]
    })
  }, [url])

  // 图片加载完 → 下一帧置 shown 触发「模糊→清晰 + 淡入」过渡（rAF 确保初始模糊态先绘出、过渡才生效）
  const fadeIn = (id: number) =>
    requestAnimationFrame(() =>
      setLayers((cur) => cur.map((l) => (l.id === id ? { ...l, shown: true } : l))),
    )

  const onEnd = (id: number, shown: boolean) => {
    if (shown) {
      // 顶层渐入完成 → 丢弃它下面的旧层
      setLayers((cur) => {
        const idx = cur.findIndex((l) => l.id === id)
        return idx <= 0 ? cur : cur.slice(idx)
      })
    } else {
      // 淡出完成（还原默认）→ 移除该层
      setLayers((cur) => cur.filter((l) => l.id !== id))
    }
  }

  if (!baseUrl && layers.length === 0) return null

  return (
    <>
      {baseUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={baseUrl} alt="" draggable={false} style={{ ...COVER, filter: extraFilter || undefined }} />
      )}
      {layers.map((l) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={l.id}
          src={l.url}
          alt=""
          draggable={false}
          onLoad={() => fadeIn(l.id)}
          onError={() => setLayers((cur) => cur.filter((x) => x.id !== l.id))}
          onTransitionEnd={(e) => {
            if (e.propertyName === "opacity") onEnd(l.id, l.shown)
          }}
          style={{
            ...COVER,
            opacity: l.shown ? 1 : 0,
            filter: `${l.shown ? "blur(0px)" : "blur(20px)"}${extraFilter ? ` ${extraFilter}` : ""}`,
            transform: l.shown ? "scale(1)" : "scale(1.06)",
            transition: "opacity 0.8s ease, filter 0.8s ease, transform 0.8s ease",
            willChange: "opacity, filter, transform",
          }}
        />
      ))}
    </>
  )
}
