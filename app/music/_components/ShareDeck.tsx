"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence } from "framer-motion"
import {
  X,
  Send,
  Loader2,
  Music2,
  Play,
  Download,
  Link2,
  RefreshCw,
  ImageIcon,
  MessageSquarePlus,
} from "lucide-react"
import { type Track } from "../_data/tracks"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabaseClient"
import { createPost } from "@/lib/supabase"
import { CATEGORIES } from "@/lib/categories"
import { guardVerify } from "@/lib/verify-gate-bus"
import { useIsAndroid } from "../_lib/useIsAndroid"
import { useIsMobile } from "../_lib/useIsMobile"
import { generatePoster, type ShareInput } from "@/lib/share/poster"
import { SITE_URL } from "@/lib/site-url"
import type { SharedMusic } from "@/lib/types"

// 触屏端 <a download> 不一定进相册，长按更稳；安卓 WebView backdrop-filter 脆弱，降级实底。
const IS_TOUCH =
  typeof window !== "undefined" &&
  ("ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0)

// data URL → Blob（本地歌封面是小 JPEG data URL，发布时托管一份给别人看）。
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return await res.blob()
}

// ---- 卡组几何：后卡的位移/倾斜/缩放。想再突显就调大 BACK_POSE 的 x（往外探）/ y（探出高度）/
//      TILT_DEG（倾斜角，别超 ~35 否则像要倒）/ opacity（亮度）。 ----
const CARD_W = "min(340px, 86vw)" // 自适应宽度，小屏手机不切边
const CARD_H = "min(600px, 74vh)" // 两张卡固定等高 → 后卡探出来是满高一条、更显眼
const TILT_DEG = 24
const FRONT_POSE = { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }
const BACK_POSE = { x: 104, y: 44, rotate: TILT_DEG, scale: 0.9, opacity: 0.82 }

type DeckSide = "poster" | "forum"

/**
 * 「分享卡组」：把「分享海报」与「发到论坛」叠成两张可切换的卡片。
 * 前卡正常可用、后卡斜着探在身后；鼠标 hover（或触屏点一下）后卡 → 它滑到前面、另一张退到身后。
 * 海报卡复用 generatePoster（与帖子分享同一套，不动原弹窗）；论坛卡走 lib/createPost。
 * 安卓 WebView 降级实底、切换只用 transform/opacity 合成层动画，避鬼影。
 */
function ShareDeck({
  track,
  hue = 150,
  onClose,
}: {
  track: Track | null
  hue?: number
  onClose: () => void
}) {
  const { user } = useSimpleAuth()
  const { toast } = useToast()
  const isAndroid = useIsAndroid()
  const isMobile = useIsMobile()
  const [mounted, setMounted] = useState(false)
  const [front, setFront] = useState<DeckSide>("poster")

  // ---- 论坛卡状态 ----
  const [caption, setCaption] = useState("")
  const [category, setCategory] = useState<string>("general")
  const [submitting, setSubmitting] = useState(false)

  // ---- 海报卡状态 ----
  const [pStatus, setPStatus] = useState<"loading" | "ready" | "error">("loading")
  const [poster, setPoster] = useState<string | null>(null)
  // 安卓入场闸门：海报揭示推迟到入场淡入之后，避免重 PNG 解码与入场同帧撕裂（对标原海报弹窗）。
  const [entered, setEntered] = useState(!isAndroid)

  useEffect(() => setMounted(true), [])

  // 打开/换歌：重置输入与卡面，默认海报在前。
  useEffect(() => {
    if (track) {
      setCaption("")
      setCategory("general")
      setFront("poster")
    }
  }, [track?.id])

  const url = `${SITE_URL}/music`
  // 通过 ref 读最新海报输入，让生成函数稳定（父组件随播放进度每帧重渲不影响）。
  const inputRef = useRef<ShareInput>({
    kind: "music",
    title: track?.title ?? "",
    artist: track?.artist ?? "",
    coverUrl: track?.cover ?? null,
    hue,
    url,
  })
  inputRef.current = {
    kind: "music",
    title: track?.title ?? "",
    artist: track?.artist ?? "",
    coverUrl: track?.cover ?? null,
    hue,
    url,
  }

  const runGenerate = useCallback(() => {
    let cancelled = false
    setPStatus("loading")
    setPoster(null)
    generatePoster(inputRef.current)
      .then((u) => {
        if (cancelled) return
        setPoster(u)
        setPStatus("ready")
      })
      .catch((e) => {
        if (cancelled) return
        console.error("[share-deck] poster generation failed", e)
        setPStatus("error")
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 打开时生成海报（按歌曲 id 触发；不受 input 对象每帧抖动影响）。
  useEffect(() => {
    if (!track) return
    return runGenerate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, runGenerate])

  // 安卓入场闸门计时。
  useEffect(() => {
    if (!isAndroid) return
    if (!track) {
      setEntered(false)
      return
    }
    const t = window.setTimeout(() => setEntered(true), 240)
    return () => window.clearTimeout(t)
  }, [track?.id, isAndroid])

  // Esc 关闭
  useEffect(() => {
    if (!track) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [track, onClose, submitting])

  const playable = !!track && !track.local && !!track.audio

  const handlePublish = async () => {
    if (!track) return
    if (!user) {
      toast({ title: "请先登录", description: "发布到论坛前请先登录账号", variant: "destructive" })
      return
    }
    if (guardVerify()) return
    try {
      setSubmitting(true)
      let cover = ""
      if (track.local) {
        if (track.cover && track.cover.startsWith("data:")) {
          try {
            const blob = await dataUrlToBlob(track.cover)
            const name = `music-${Math.random().toString(36).slice(2, 12)}.jpg`
            const { data, error } = await supabase.storage
              .from("post-images")
              .upload(name, blob, { cacheControl: "31536000", upsert: false, contentType: "image/jpeg" })
            if (error) throw error
            cover = supabase.storage.from("post-images").getPublicUrl(data.path).data.publicUrl
          } catch (coverErr) {
            console.warn("本地歌封面托管失败（不影响发布）:", coverErr)
          }
        }
      } else {
        cover = track.cover || ""
      }
      const music: SharedMusic = {
        title: track.title,
        artist: track.artist,
        cover,
        audio: playable ? track.audio : "",
        source: track.local ? "local" : track.userProvided ? "link" : "featured",
        playable,
      }
      const text = caption.trim()
      const title = text || `${track.title} - ${track.artist}`
      await createPost({ title, content: text, description: text, category, music })
      toast({ title: "已发布到论坛", description: "可在首页看到这张音乐卡" })
      onClose()
    } catch (err: any) {
      console.error("发布音乐卡失败:", err)
      toast({ title: "发布失败", description: err?.message || "请稍后重试", variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const handleSave = useCallback(() => {
    if (!poster || !track) return
    const a = document.createElement("a")
    a.href = poster
    a.download = `萤火虫之国-${(track.title || "分享").slice(0, 20)}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast({ title: "已保存", description: IS_TOUCH ? "若未弹出保存，请长按图片保存到相册" : "海报已下载" })
  }, [poster, track, toast])

  const handleCopy = useCallback(async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(url)
      ok = true
    } catch {
      try {
        const ta = document.createElement("textarea")
        ta.value = url
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.select()
        ok = document.execCommand("copy")
        document.body.removeChild(ta)
      } catch {
        ok = false
      }
    }
    toast({
      title: ok ? "链接已复制" : "复制失败",
      description: ok ? "粘贴到微信 / QQ 即可分享" : "请手动复制",
      variant: ok ? undefined : "destructive",
    })
  }, [url, toast])

  if (!mounted) return null

  const accent = `hsl(${hue} 72% 62%)`
  const accentDim = `hsl(${hue} 60% 55% / 0.16)`
  // 毛玻璃：桌面/iOS 真磨砂；安卓 WebView 降级实底（backdrop-filter 在安卓会鬼影/撕裂）。
  const panelBg = isAndroid ? "rgba(19,20,26,0.98)" : "rgba(24,25,32,0.55)"
  const panelBlur = isAndroid ? undefined : "blur(40px) saturate(160%)"
  const panelShadow = isAndroid
    ? "0 30px 80px -24px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06)"
    : "0 30px 80px -24px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.14), 0 0 0 1px rgba(255,255,255,0.08)"

  // 共用卡片外壳
  const cardFrame = (side: DeckSide, body: React.ReactNode, title: string, icon: React.ReactNode) => {
    const isFront = front === side
    const pose = isFront ? FRONT_POSE : BACK_POSE
    // 安卓 WebView：切换卡片时，缩放(后卡 0.9↔前卡 1)会逐帧重光栅化大圆角+大阴影、透明度(0.82↔1)会
    // 撕裂合成层显存缓冲（本项目反复踩的安卓老坑），两者叠加 = 「切换卡片闪屏」。
    // 故安卓前后卡的缩放/透明度恒为 1，纯靠位移(x/y)+倾斜(rotate)+层级遮挡区分前后，
    // 切换动画只剩 transform 位移/旋转 = 合成器友好、不重栅格、不撕裂。桌面/iOS 维持显小+变暗的精致效果。
    const usePose = isAndroid
      ? { x: pose.x, y: pose.y, rotate: pose.rotate, scale: 1, opacity: 1 }
      : pose
    return (
      <motion.div
        className="flex flex-col overflow-hidden rounded-[26px] border border-white/12"
        style={{
          gridArea: "1 / 1",
          width: CARD_W,
          height: CARD_H,
          zIndex: isFront ? 20 : 10,
          background: panelBg,
          backdropFilter: panelBlur,
          WebkitBackdropFilter: panelBlur,
          boxShadow: panelShadow,
          cursor: isFront ? "default" : "pointer",
        }}
        // 安卓：卡片不自己做透明度/缩放入场动画，交给最外层那层统一的 opacity 淡入（避免多个合成层并发创建撕裂）。
        initial={isAndroid ? usePose : { ...pose, opacity: 0, scale: pose.scale * 0.96 }}
        animate={usePose}
        // 鼠标悬停：当前指着的卡片放大一档；后卡顺带提亮到不透明（"选中"反馈）。松开回弹。
        // 安卓禁用：触屏点击会误触发 whileHover 的缩放动画，又是一次重栅格闪。
        whileHover={isAndroid ? undefined : { scale: pose.scale * 1.05, opacity: 1, transition: { duration: 0.2, ease: "easeOut" } }}
        // 安卓退场同样交给最外层 opacity，卡片自己不再做透明度退场（避撕裂）。
        exit={isAndroid ? undefined : { opacity: 0, transition: { duration: 0.16 } }}
        transition={{ duration: 0.4, ease: [0.2, 0.85, 0.25, 1] }}
        onClick={(e) => {
          e.stopPropagation()
          if (!isFront) setFront(side)
        }}
      >
          {/* 顶部辉光（封面主色） */}
          <div
            className="pointer-events-none relative h-0"
            aria-hidden
          >
            <div
              className="absolute inset-x-0 top-0 h-24"
              style={{ background: `radial-gradient(130% 100% at 50% 0%, hsl(${hue} 78% 56% / 0.18), transparent 72%)` }}
            />
          </div>

          {/* 标题栏 */}
          <div className="relative flex shrink-0 items-center justify-between px-5 pt-4 pb-1">
            <div className="flex items-center gap-2.5 text-[15px] font-semibold text-white">
              <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: accentDim, color: accent }}>
                {icon}
              </span>
              {title}
            </div>
            {isFront ? (
              <button
                type="button"
                aria-label="关闭"
                disabled={submitting}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                className="grid h-8 w-8 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <X size={16} />
              </button>
            ) : (
              <span className="rounded-full px-2 py-0.5 text-[11px] text-white/45">点这张切换 →</span>
            )}
          </div>

        {/* 卡身：后卡不可交互（整卡作为切换热区）。flex-1 撑满固定卡高 → 内容弹性填充 */}
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ pointerEvents: isFront ? "auto" : "none" }}>
          {body}
        </div>
      </motion.div>
    )
  }

  // ---- 海报卡身 ----
  const posterBody = (
    <div className="flex h-full flex-col px-5 pb-5 pt-3">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {(pStatus === "loading" || (pStatus === "ready" && !entered)) && (
          <div className="flex flex-col items-center gap-3 py-16 text-white/55">
            <Loader2 className="h-7 w-7 animate-spin" style={{ color: accent }} />
            <span className="text-sm">正在生成精美海报…</span>
          </div>
        )}
        {pStatus === "error" && (
          <div className="flex flex-col items-center gap-3 py-16 text-white/55">
            <span className="text-sm">海报生成失败</span>
            <button
              type="button"
              onClick={runGenerate}
              className="flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-1.5 text-sm text-white/80 hover:bg-white/10"
            >
              <RefreshCw className="h-3.5 w-3.5" /> 重试
            </button>
          </div>
        )}
        {pStatus === "ready" && poster && entered && (
          <motion.img
            src={poster}
            alt="分享海报"
            className="rounded-2xl shadow-lg"
            style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
            draggable={false}
            decoding="async"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          />
        )}
      </div>
      {pStatus === "ready" && IS_TOUCH && (
        <p className="shrink-0 pt-2 text-center text-xs text-white/40">长按图片可保存到相册</p>
      )}
      <div className="mt-3 flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pStatus !== "ready"}
          className="flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: accent }}
        >
          <Download className="h-4 w-4" /> 保存图片
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="flex flex-1 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-3 text-sm font-medium text-white/90 transition-colors hover:bg-white/20"
        >
          <Link2 className="h-4 w-4" /> 复制链接
        </button>
      </div>
    </div>
  )

  // ---- 论坛卡身 ----
  const forumBody = (
    <div className="flex h-full flex-col px-5 pb-5 pt-3">
      {/* 音乐卡预览 */}
      <div className="flex shrink-0 items-center gap-3.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <div
          className="relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl"
          style={{
            background: `linear-gradient(135deg, hsl(${hue} 48% 30%), hsl(${(hue + 40) % 360} 48% 18%))`,
            boxShadow: `0 10px 28px -8px hsl(${hue} 70% 42% / 0.6)`,
          }}
        >
          {track?.cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={track.cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <Music2 size={26} className="text-white/70" />
          )}
          {playable && (
            <span className="absolute inset-0 grid place-items-center bg-black/20">
              <Play
                size={24}
                fill="currentColor"
                className="translate-x-[1px] text-white"
                style={{ filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.5))" }}
              />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-white">{track?.title}</div>
          <div className="mt-0.5 truncate text-xs text-white/55">{track?.artist}</div>
          <span
            className="mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={playable ? { background: accentDim, color: accent } : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)" }}
          >
            {playable ? "可在线播放" : "本地歌 · 仅展示"}
          </span>
        </div>
      </div>

      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="说点什么…（可留空）"
        maxLength={500}
        className="mt-3.5 min-h-[64px] w-full flex-1 resize-none rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-sm leading-relaxed text-white placeholder:text-white/30 focus:border-white/25 focus:bg-white/[0.06] focus:outline-none"
      />

      <div className="mt-3 flex shrink-0 flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const active = category === c.value
          return (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className="rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-95"
              style={{
                borderColor: active ? accent : "rgba(255,255,255,0.10)",
                background: active ? accentDim : "transparent",
                color: active ? "#fff" : "rgba(255,255,255,0.55)",
              }}
            >
              <span className="mr-1 opacity-70">{c.glyph}</span>
              {c.label}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={handlePublish}
        disabled={submitting}
        className="mt-4 flex w-full shrink-0 items-center justify-center gap-1.5 rounded-full px-5 py-3 text-sm font-semibold text-black transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-60"
        style={{ background: accent, boxShadow: `0 8px 22px -6px hsl(${hue} 72% 50% / 0.55)` }}
      >
        {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        {submitting ? "发布中…" : "发布到论坛"}
      </button>
    </div>
  )

  return createPortal(
    <AnimatePresence>
      {track && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          initial={isAndroid ? { opacity: 0 } : { pointerEvents: "none" as const }}
          animate={isAndroid ? { opacity: 1 } : { pointerEvents: "auto" as const }}
          exit={isAndroid ? { opacity: 0 } : { pointerEvents: "none" as const }}
          transition={isAndroid ? { duration: 0.2 } : undefined}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* 遮罩：自身做 opacity 淡入（兄弟节点，不影响卡片毛玻璃）。安卓由最外层统一驱动、此处静态。 */}
          <motion.div
            className="absolute inset-0"
            style={{
              background: isAndroid ? "rgba(6,8,10,0.82)" : "rgba(0,0,0,0.5)",
              backdropFilter: isAndroid ? undefined : "blur(8px)",
              WebkitBackdropFilter: isAndroid ? undefined : "blur(8px)",
            }}
            initial={isAndroid ? false : { opacity: 0 }}
            animate={isAndroid ? undefined : { opacity: 1 }}
            exit={isAndroid ? undefined : { opacity: 0 }}
            transition={isAndroid ? undefined : { duration: 0.2 }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget && !submitting) onClose()
            }}
          />

          {/* 卡组：两张卡叠在同一格，靠 transform 错开。手机端整组等比缩小（不切边） */}
          <div
            className="relative grid place-items-center"
            style={{ width: CARD_W, transform: isMobile ? "scale(0.84)" : undefined }}
          >
            {cardFrame("poster", posterBody, "分享海报", <ImageIcon size={15} />)}
            {cardFrame("forum", forumBody, "发到论坛", <MessageSquarePlus size={15} />)}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export default memo(ShareDeck)
