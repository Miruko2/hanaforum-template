"use client"

import { useRef, useState } from "react"
import { motion } from "framer-motion"
import { Heart, Scissors } from "lucide-react"
import type { Post } from "@/lib/types"
import { cdnUrl } from "@/lib/cdn-url"
import { postThumbUrl } from "@/lib/post-image-thumb"
import { postImageList } from "@/lib/post-images"
import { CATEGORIES } from "@/lib/categories"
import { StickerText } from "@/components/stickers/sticker-text"
import ImageLightbox from "@/components/image-lightbox"

// 集邮册里点开一张邮票后的详情：一张「登机牌 / 票券」（参考 DoubleBullet Boarding Pass），
// 不再套外层毛玻璃面板——只这张大票券浮在遮罩上。主联放帖子图 + 双语字段（含点赞数），
// 撕裂线分隔出副券（编号 / 伪二维码）；配色跟随集邮册当前主题色。
//   入场：从偏下、带模糊快速浮现并上滑归位（安卓去模糊防 WebView 闪）。
//   撕开：鼠标/触摸沿虚线往下拖 → 副券沿撕裂线裂开，过阈值即弹出原帖子。

const IS_ANDROID = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)

// 集邮册主题色 → 票券点缀色
const ACCENT: Record<string, string> = {
  amber: "#c9991f",
  pink: "#d4537e",
  ink: "#3b7fe0",
  lime: "#5f9e1a",
}

const INK = "#23262e" // 票券正文深色
const SUB = "#8a8f99" // 字段小标签灰
const PAPER = "#eef1f6" // 票券纸面
const NOTCH = "#14151b" // 撕裂口（露出深色遮罩的近似色）

const TEAR_THRESHOLD = 0.55 // 撕开进度过这个就算撕断

interface CollectionPostcardProps {
  post: Post
  username: string
  color: string
  index: number // 票券编号 No. = 邮票序号
  likeCount: number
  onOpenPost: () => void // 撕开后弹出原帖子
}

// 小字段：双语标签（中/日 + english）+ 值
function Field({ label, en, value }: { label: string; en: string; value: string }) {
  return (
    <div className="min-w-0">
      <div style={{ fontSize: 9, letterSpacing: "0.04em", color: SUB }}>
        {label} <span style={{ fontSize: 8 }}>（{en}）</span>
      </div>
      <div className="truncate" style={{ fontSize: 13, fontWeight: 700, color: INK, marginTop: 1 }}>
        {value || "—"}
      </div>
    </div>
  )
}

export default function CollectionPostcard({
  post,
  username,
  color,
  index,
  likeCount,
  onOpenPost,
}: CollectionPostcardProps) {
  const images = postImageList(post)
  const [lbOpen, setLbOpen] = useState(false)
  const [lbIndex, setLbIndex] = useState(0)

  const accent = ACCENT[color] || ACCENT.ink
  const categoryDef = CATEGORIES.find((c) => c.value === post.category)
  const categoryLabel = categoryDef?.label || post.category || "综合"
  const heroImg = images[0] ? cdnUrl(postThumbUrl(images[0])) || cdnUrl(images[0]) || "" : ""
  const musicCover = post.music?.cover ? cdnUrl(post.music.cover) || "" : ""
  const visual = heroImg || musicCover
  const no = String(index >= 0 ? index + 1 : 0).padStart(2, "0")
  const dateShort = post.created_at ? new Date(post.created_at).toLocaleDateString("ja-JP") : ""
  const body = (post.description || post.content || "").trim()

  // 伪二维码：按帖子 id 生成稳定的 6×6 点阵（纯装饰）
  const qr = Array.from({ length: 36 }, (_, i) => {
    const c = post.id.charCodeAt(i % post.id.length)
    return (c + i * 7) % 3 !== 0
  })

  // ───────── 撕开手势 ─────────
  const [tear, setTear] = useState(0) // 0→1 撕开进度（副券沿撕裂线裂开）
  const tearingRef = useRef(false)
  const tearRef = useRef(0)
  const doneRef = useRef(false)
  const startYRef = useRef(0)
  const hRef = useRef(1)

  const finishTear = () => {
    if (doneRef.current) return
    doneRef.current = true
    tearingRef.current = false
    tearRef.current = 1
    setTear(1)
    // 先让裂开动画推到全开，再弹出原帖子
    window.setTimeout(() => onOpenPost(), 240)
  }
  const onTearDown = (e: React.PointerEvent) => {
    if (doneRef.current) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    tearingRef.current = true
    startYRef.current = e.clientY
    hRef.current = (e.currentTarget as HTMLElement).getBoundingClientRect().height || 1
  }
  const onTearMove = (e: React.PointerEvent) => {
    if (!tearingRef.current || doneRef.current) return
    const p = Math.max(0, Math.min(1, (e.clientY - startYRef.current) / hRef.current))
    tearRef.current = p
    setTear(p)
    if (p >= 0.97) finishTear()
  }
  const onTearUp = (e: React.PointerEvent) => {
    if (!tearingRef.current) return
    tearingRef.current = false
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    if (tearRef.current >= TEAR_THRESHOLD) finishTear()
    else {
      tearRef.current = 0
      setTear(0)
    }
  }

  // 入场：偏下 + 模糊 → 上滑归位 + 收实
  const initial = IS_ANDROID
    ? { opacity: 0, y: 70, scale: 0.92 }
    : { opacity: 0, y: 70, scale: 0.92, filter: "blur(16px)" }
  const animate = IS_ANDROID
    ? { opacity: 1, y: 0, scale: 1 }
    : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }

  return (
    <div className="relative z-10 max-h-[92vh] w-[min(720px,96vw)] touch-pan-y overflow-y-auto overflow-x-hidden">
      <motion.div initial={initial} animate={animate} transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}>
        {/* ───────── 票券 ───────── */}
        <div className="relative flex">
          {/* 主联 */}
          <div
            className="relative flex-1 overflow-hidden rounded-l-2xl p-4"
            style={{
              background: PAPER,
              boxShadow: "0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.6)",
            }}
          >
            {/* 斜向半调条纹底纹 */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: `repeating-linear-gradient(118deg, ${accent}1f 0 9px, transparent 9px 26px)`,
              }}
            />
            <div className="relative">
              {/* 抬头 */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <span style={{ fontSize: 19, fontWeight: 800, color: INK, letterSpacing: "-0.01em" }}>
                    Boarding Pass
                  </span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: accent }}>✦✦✦</span>
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", color: SUB }}>ARCHIVE</span>
              </div>

              {/* 帖子图 + 标题 */}
              <div className="mb-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (images.length) {
                      setLbIndex(0)
                      setLbOpen(true)
                    }
                  }}
                  className="relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-lg"
                  style={{ border: `2px solid ${INK}`, cursor: images.length ? "zoom-in" : "default" }}
                  aria-label={images.length ? "查看大图" : undefined}
                >
                  {visual ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={visual} alt="" className="h-full w-full object-cover" draggable={false} />
                  ) : (
                    <span
                      className="flex h-full w-full items-center justify-center text-2xl"
                      style={{ background: `${accent}22`, color: accent }}
                    >
                      {post.imageContent || (post.music ? "♪" : "✉")}
                    </span>
                  )}
                  {images.length > 1 && (
                    <span
                      className="absolute bottom-1 right-1 rounded px-1 text-[10px] font-bold text-white"
                      style={{ background: "rgba(0,0,0,0.6)" }}
                    >
                      +{images.length - 1}
                    </span>
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 9, letterSpacing: "0.04em", color: SUB }}>
                    件名 <span style={{ fontSize: 8 }}>（title）</span>
                  </div>
                  <h3
                    className="mt-0.5"
                    style={{
                      fontSize: 17,
                      fontWeight: 800,
                      color: INK,
                      lineHeight: 1.2,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {post.title || "无标题"}
                  </h3>
                  <span
                    className="mt-1.5 inline-block rounded px-2 py-0.5 text-[11px] font-bold"
                    style={{ background: `${accent}1f`, color: accent }}
                  >
                    {categoryDef?.glyph ? `${categoryDef.glyph} ` : ""}
                    {categoryLabel}
                  </span>
                </div>
              </div>

              {/* 字段：作者 / 日期 / 点赞数 */}
              <div className="grid grid-cols-3 gap-2">
                <Field label="氏名" en="name" value={username} />
                <Field label="日付" en="date" value={dateShort} />
                <div className="min-w-0">
                  <div style={{ fontSize: 9, letterSpacing: "0.04em", color: SUB }}>
                    いいね <span style={{ fontSize: 8 }}>（likes）</span>
                  </div>
                  <div
                    className="mt-0.5 flex items-center gap-1"
                    style={{ fontSize: 13, fontWeight: 700, color: INK }}
                  >
                    <Heart className="h-3.5 w-3.5" style={{ fill: accent, color: accent }} />
                    {likeCount}
                  </div>
                </div>
              </div>

              {/* 备考（正文） */}
              {body && (
                <div className="mt-3">
                  <div style={{ fontSize: 9, letterSpacing: "0.04em", color: SUB }}>
                    備考 <span style={{ fontSize: 8 }}>（remarks）</span>
                  </div>
                  <p
                    className="mt-0.5 whitespace-pre-line"
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.5,
                      color: "#3a3e47",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    <StickerText text={body} />
                  </p>
                </div>
              )}

              {/* 条形码 */}
              <div
                className="mt-3 h-7 w-2/3"
                style={{
                  backgroundImage: `repeating-linear-gradient(90deg, ${INK} 0 2px, transparent 2px 3px, ${INK} 3px 5px, transparent 5px 9px)`,
                }}
              />
            </div>
          </div>

          {/* 撕裂线 + 撕裂口 + 撕开热区（沿虚线往下拖即裂开） */}
          <div className="relative z-20 w-0 shrink-0">
            <div className="absolute inset-y-3 left-0 border-l-2 border-dashed" style={{ borderColor: `${accent}80` }} />
            <span className="absolute -left-2.5 -top-2.5 z-10 h-5 w-5 rounded-full" style={{ background: NOTCH }} />
            <span className="absolute -bottom-2.5 -left-2.5 z-10 h-5 w-5 rounded-full" style={{ background: NOTCH }} />
            {/* 撕开热区：覆盖整条虚线，触屏锁竖向手势改为撕 */}
            <div
              className="absolute -left-4 inset-y-0 z-20 flex w-8 cursor-grab touch-none select-none justify-center active:cursor-grabbing"
              onPointerDown={onTearDown}
              onPointerMove={onTearMove}
              onPointerUp={onTearUp}
              onPointerCancel={onTearUp}
              role="button"
              aria-label="沿虚线撕开，查看原帖子"
            >
              <Scissors
                className="mt-1 h-4 w-4"
                style={{ color: INK, opacity: 0.45 - tear * 0.4, transform: "rotate(90deg)" }}
              />
            </div>
          </div>

          {/* 副券（撕开时沿撕裂线裂开：以左下为轴外翻 + 右移 + 抬起阴影） */}
          <div
            className="overflow-hidden rounded-r-2xl p-3.5"
            style={{
              background: PAPER,
              backgroundImage: `linear-gradient(0deg, ${accent}12, ${accent}12)`,
              transform: `rotate(${tear * 18}deg) translateX(${tear * 26}px)`,
              transformOrigin: "left bottom",
              transition: tearingRef.current ? "none" : "transform 0.45s cubic-bezier(0.22,1,0.36,1)",
              boxShadow:
                tear > 0.02
                  ? `0 ${10 + tear * 22}px ${20 + tear * 34}px rgba(0,0,0,${0.18 + tear * 0.28})`
                  : "0 24px 60px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.6)",
              width: 136,
              flexShrink: 0,
              position: "relative",
              zIndex: 5,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, fontStyle: "italic", color: INK, lineHeight: 1.1 }}>
              蛍火
              <br />
              ARCHIVE
            </div>
            <div className="mt-0.5" style={{ fontSize: 9, fontWeight: 700, color: accent }}>
              ✦✦✦
            </div>

            <div className="mt-4">
              <div style={{ fontSize: 9, letterSpacing: "0.04em", color: SUB }}>No.</div>
              <div style={{ fontSize: 30, fontWeight: 800, color: accent, lineHeight: 1 }}>{no}</div>

              {/* 伪二维码 */}
              <div className="mt-2 grid gap-px" style={{ gridTemplateColumns: "repeat(6, 1fr)", width: 48, height: 48 }}>
                {qr.map((on, i) => (
                  <span key={i} style={{ background: on ? INK : "transparent" }} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 撕开提示 */}
        <p className="mt-3 text-center text-xs text-white/45">
          沿副券虚线往下撕开 · 看原帖
        </p>
      </motion.div>

      {/* 图片灯箱：点票券里的帖子图放大；单图带主体遮罩走视差 */}
      <ImageLightbox
        images={lbOpen ? images.map((u) => cdnUrl(u) || u) : null}
        maskSrc={
          lbOpen && images.length === 1 && post.image_mask_url
            ? cdnUrl(post.image_mask_url) || post.image_mask_url
            : null
        }
        index={lbIndex}
        onIndexChange={setLbIndex}
        alt={post.title}
        onClose={() => setLbOpen(false)}
      />
    </div>
  )
}
