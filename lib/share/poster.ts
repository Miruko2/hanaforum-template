// 分享海报生成器（纯客户端 Canvas，零服务器/egress 成本）。
//
// 为什么是「海报」而不是「调起微信分享」：微信不允许非备案 + 未认证公众号的网页
// 调用 JS-SDK 自定义分享，微信外的浏览器更是无法用代码调起微信/QQ 分享框。通用解法
// 是生成一张带二维码的海报图，用户保存后随手发微信/QQ —— 绕开备案与链接拦截。
//
// CORS 策略（canvas.toDataURL 要求画布未被跨域图污染，与 useDominantHue 完全一致）：
//   · 网易封面（music.126.net，无 CORS 头）→ 走同源 /api/img-proxy。
//   · 头像 / 帖子图 / 自有 CDN（Supabase + CF Worker 都发 ACAO:*）→ cdnUrl() 直取。
//   · 任意图加载失败 → 返回 null，绘制时优雅降级（头像画首字母、封面画 hue 渐变），
//     画布永不污染，toDataURL 不会抛错。
//
// qrcode 在本模块内 `await import()` 动态加载 —— 本模块只被「分享弹窗」(dynamic ssr:false)
// 引用，故二维码库与海报代码全部落在按需 chunk，主包与 /music 首屏体积不变。

import { cdnUrl } from "@/lib/cdn-url"
import { apiUrl } from "@/lib/api-base"
import { SITE_NAME } from "@/lib/site-url"
import { neteaseDirectCover } from "@/app/music/_lib/neteasePic"

export interface SharePostInput {
  kind: "post"
  title?: string | null
  content: string
  author: string
  avatarUrl?: string | null
  imageUrl?: string | null
  /** 二维码指向 + 复制链接用的 URL */
  url: string
}

export interface ShareMusicInput {
  kind: "music"
  title: string
  artist: string
  coverUrl?: string | null
  /** 封面主色相 0..359，用于辉光/波形着色；缺省走品牌绿 */
  hue?: number | null
  url: string
}

export type ShareInput = SharePostInput | ShareMusicInput

// ---- 设计常量（绝区零深色霓虹风，主色对齐站点 lime-400 #a3e635）----
const W = 750
const FONT =
  '"PingFang SC","Microsoft YaHei","Noto Sans SC","Hiragino Sans GB",system-ui,-apple-system,sans-serif'
const LIME = "#a3e635"
const TWO_PI = Math.PI * 2

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT}`
}

// ---- 图片加载：按来源选代理 / 直取，带超时兜底，失败返回 null（不污染画布）----
function resolveSrc(rawUrl: string): string {
  if (/music\.126\.net/i.test(rawUrl)) {
    return apiUrl(`/api/img-proxy?url=${encodeURIComponent(rawUrl)}`)
  }
  return cdnUrl(rawUrl) || rawUrl
}

function loadImage(rawUrl: string | null | undefined): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!rawUrl) return resolve(null)
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.decoding = "async"
    let settled = false
    const finish = (v: HTMLImageElement | null) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    img.onload = () => finish(img)
    img.onerror = () => finish(null)
    // 网络慢 / 被墙时不让海报生成卡死
    setTimeout(() => finish(null), 9000)
    img.src = resolveSrc(rawUrl)
  })
}

// ---- 几何 / 绘制小工具 ----
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** object-cover：把 img 等比裁剪铺满目标框 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const ir = img.width / img.height
  const dr = dw / dh
  let sw: number, sh: number, sx: number, sy: number
  if (ir > dr) {
    sh = img.height
    sw = sh * dr
    sx = (img.width - sw) / 2
    sy = 0
  } else {
    sw = img.width
    sh = sw / dr
    sx = 0
    sy = (img.height - sh) / 2
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

function isCJK(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (
    (c >= 0x3000 && c <= 0x9fff) || // CJK 统一表意 + 符号
    (c >= 0xff00 && c <= 0xffef) || // 全角
    (c >= 0x3040 && c <= 0x30ff) // 假名
  )
}

/**
 * CJK 友好的换行：中日韩逐字可断、拉丁按词断（超长词硬断）；尊重显式换行符。
 * 完整换行后截断到 maxLines 并在末行补省略号。
 */
function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const all: string[] = []
  const paragraphs = (text || "").replace(/\r/g, "").split("\n")
  for (const para of paragraphs) {
    if (para === "") {
      all.push("")
      continue
    }
    // 分词：CJK 字符 / 空格各自成 token，拉丁连续串成一个 token
    const tokens: string[] = []
    let buf = ""
    for (const ch of para) {
      if (isCJK(ch) || ch === " ") {
        if (buf) {
          tokens.push(buf)
          buf = ""
        }
        tokens.push(ch)
      } else {
        buf += ch
      }
    }
    if (buf) tokens.push(buf)

    let line = ""
    for (const t of tokens) {
      const trial = line + t
      if (ctx.measureText(trial).width <= maxWidth) {
        line = trial
        continue
      }
      if (line === "") {
        // 单 token 比整行还宽 → 逐字硬断
        let chunk = ""
        for (const ch of t) {
          if (ctx.measureText(chunk + ch).width <= maxWidth) {
            chunk += ch
          } else {
            if (chunk) all.push(chunk)
            chunk = ch
          }
        }
        line = chunk
      } else {
        all.push(line)
        line = t === " " ? "" : t // 折行时丢弃行首空格
      }
    }
    all.push(line)
  }

  if (all.length <= maxLines) return all
  const kept = all.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last && ctx.measureText(last + "…").width > maxWidth) {
    last = last.slice(0, -1)
  }
  kept[maxLines - 1] = (last || "").replace(/\s+$/, "") + "…"
  return kept
}

/**
 * 毛玻璃底图：有主图(封面/帖子图)时铺「模糊放大主图 + 暗化」，无主图回退深色渐变 + 色相柔光；
 * 再叠暗角增层次。内容用半透明面板叠在其上 = 磨砂玻璃观感。
 */
function paintBackdrop(
  ctx: CanvasRenderingContext2D,
  h: number,
  hue: number | null,
  hero: HTMLImageElement | null,
): void {
  if (hero) {
    // 模糊放大主图铺满（overscan 防模糊边缘露空）
    ctx.save()
    ctx.filter = "blur(60px)"
    drawImageCover(ctx, hero, -60, -60, W + 120, h + 120)
    ctx.restore()
    // 暗化（上→下加深，保证文字与底部二维码可读）
    const ov = ctx.createLinearGradient(0, 0, 0, h)
    ov.addColorStop(0, "rgba(8,10,8,0.5)")
    ov.addColorStop(0.5, "rgba(8,10,8,0.58)")
    ov.addColorStop(1, "rgba(6,8,7,0.82)")
    ctx.fillStyle = ov
    ctx.fillRect(0, 0, W, h)
  } else {
    const bg = ctx.createLinearGradient(0, 0, 0, h)
    bg.addColorStop(0, "#0c120d")
    bg.addColorStop(1, "#060807")
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, h)
    const glowColor = hue == null ? "163,230,53" : hslToRgbStr(hue, 70, 55)
    const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.9)
    glow.addColorStop(0, `rgba(${glowColor},0.16)`)
    glow.addColorStop(1, "rgba(0,0,0,0)")
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, W, h * 0.5)
  }

  // 暗角
  const vig = ctx.createRadialGradient(W / 2, h / 2, h * 0.32, W / 2, h / 2, h * 0.72)
  vig.addColorStop(0, "rgba(0,0,0,0)")
  vig.addColorStop(1, "rgba(0,0,0,0.42)")
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, W, h)

  ctx.strokeStyle = "rgba(255,255,255,0.06)"
  ctx.lineWidth = 2
  roundRect(ctx, 6, 6, W - 12, h - 12, 26)
  ctx.stroke()
}

/** 毛玻璃面板：半透明白渐变 + 高光描边，叠在模糊底图上呈现磨砂玻璃质感。 */
function drawGlassPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.save()
  roundRect(ctx, x, y, w, h, r)
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, "rgba(255,255,255,0.16)")
  g.addColorStop(1, "rgba(255,255,255,0.05)")
  ctx.fillStyle = g
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = "rgba(255,255,255,0.24)"
  ctx.lineWidth = 1.5
  roundRect(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, r)
  ctx.stroke()
}

function hslToRgbStr(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  const r = Math.round(255 * f(0))
  const g = Math.round(255 * f(8))
  const b = Math.round(255 * f(4))
  return `${r},${g},${b}`
}

/** 顶部品牌行：logo + 站名 + 右侧「分享」标 */
async function drawBrand(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null): Promise<void> {
  const cx = 56 + 22
  const cy = 74
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, 22, 0, TWO_PI)
  ctx.closePath()
  ctx.clip()
  if (logo) {
    drawImageCover(ctx, logo, cx - 22, cy - 22, 44, 44)
  } else {
    ctx.fillStyle = LIME
    ctx.fillRect(cx - 22, cy - 22, 44, 44)
  }
  ctx.restore()

  ctx.fillStyle = "#ffffff"
  ctx.font = font(700, 30)
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  ctx.fillText(SITE_NAME, 56 + 56, cy - 1)

  // 右侧标签
  ctx.font = font(500, 20)
  ctx.fillStyle = "rgba(163,230,53,0.85)"
  ctx.textAlign = "right"
  ctx.fillText("· 分享 ·", W - 56, cy - 1)
}

/** 头像圆：有图 object-cover，无图画品牌绿渐变 + 首字母 */
function drawAvatar(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  cx: number,
  cy: number,
  r: number,
  name: string,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TWO_PI)
  ctx.closePath()
  ctx.clip()
  if (img) {
    drawImageCover(ctx, img, cx - r, cy - r, r * 2, r * 2)
  } else {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
    g.addColorStop(0, "#bef264")
    g.addColorStop(1, "#3f6212")
    ctx.fillStyle = g
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
    ctx.fillStyle = "rgba(0,0,0,0.6)"
    ctx.font = font(700, r)
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    const ch = (name || "?").trim().slice(0, 1).toUpperCase() || "?"
    ctx.fillText(ch, cx, cy + 1)
  }
  ctx.restore()
  ctx.strokeStyle = "rgba(255,255,255,0.28)"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TWO_PI)
  ctx.stroke()
}

/** 底部二维码卡 + 引导文案 */
async function drawQRBlock(
  ctx: CanvasRenderingContext2D,
  url: string,
  x: number,
  y: number,
  caption: string,
  sub: string,
): Promise<void> {
  const qr = 150
  const pad = 14
  const cardSize = qr + pad * 2
  // 白色圆角卡（保证扫码对比度）
  ctx.save()
  ctx.shadowColor = "rgba(0,0,0,0.4)"
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 8
  ctx.fillStyle = "#ffffff"
  roundRect(ctx, x, y, cardSize, cardSize, 18)
  ctx.fill()
  ctx.restore()

  // qrcode 是 CommonJS 包，不同打包器下 import() 的 default/具名形态不一，
  // `mod.default ?? mod` 在两种 interop 下都能落到带 toCanvas 的对象上。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("qrcode")
  const QRCode = mod.default ?? mod
  const tmp = document.createElement("canvas")
  await QRCode.toCanvas(tmp, url, {
    margin: 0,
    width: qr,
    errorCorrectionLevel: "M",
    color: { dark: "#0b0f0c", light: "#ffffff" },
  })
  ctx.drawImage(tmp, x + pad, y + pad, qr, qr)

  // 右侧引导文案
  const tx = x + cardSize + 28
  ctx.textAlign = "left"
  ctx.fillStyle = "#ffffff"
  ctx.font = font(700, 30)
  ctx.textBaseline = "alphabetic"
  ctx.fillText(caption, tx, y + 52)
  ctx.fillStyle = "rgba(255,255,255,0.55)"
  ctx.font = font(400, 22)
  ctx.fillText(sub, tx, y + 90)
  ctx.fillStyle = "rgba(163,230,53,0.95)"
  ctx.font = font(600, 22)
  ctx.fillText("forum.hanakos.cc", tx, y + 126)
}

// ============================ 帖子海报 ============================
async function generatePostPoster(input: SharePostInput): Promise<string> {
  const M = 56
  const cardX = M
  const cardW = W - M * 2
  const innerPad = 36
  const contentW = cardW - innerPad * 2
  const coverH = 392

  const [logo, avatar, cover] = await Promise.all([
    loadImage("/logo.png"),
    loadImage(input.avatarUrl),
    input.imageUrl ? loadImage(input.imageUrl) : Promise.resolve(null),
  ])

  // 量测：标题最多 2 行、正文最多 6 行
  const m = document.createElement("canvas").getContext("2d")!
  m.font = font(700, 34)
  const titleLines = input.title ? wrapLines(m, input.title, contentW, 2) : []
  m.font = font(400, 27)
  const bodyLines = wrapLines(m, input.content || "", contentW, 6)

  const titleLH = 46
  const bodyLH = 42
  const cardTop = 132
  // 卡片内部高度累加
  let inner = cover ? coverH + innerPad : innerPad
  inner += 64 // 头像行
  inner += 26
  if (titleLines.length) inner += titleLines.length * titleLH + 10
  inner += bodyLines.length * bodyLH
  inner += innerPad
  const cardH = inner
  const footerTop = cardTop + cardH + 40
  const H = footerTop + 178 + 48

  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext("2d")!
  ctx.textBaseline = "alphabetic"

  // 帖子图作模糊底图（无图则深色渐变）
  paintBackdrop(ctx, H, null, cover)
  await drawBrand(ctx, logo)

  // 内容卡（毛玻璃）
  drawGlassPanel(ctx, cardX, cardTop, cardW, cardH, 28)

  let y = cardTop

  // 封面图（撑满卡片宽度、顶部圆角）
  if (cover) {
    ctx.save()
    roundRect(ctx, cardX, y, cardW, coverH, 0)
    // 顶部两角圆、底部直角：单独裁剪一个上圆角矩形
    ctx.beginPath()
    const r = 28
    ctx.moveTo(cardX + r, y)
    ctx.arcTo(cardX + cardW, y, cardX + cardW, y + coverH, r)
    ctx.lineTo(cardX + cardW, y + coverH)
    ctx.lineTo(cardX, y + coverH)
    ctx.arcTo(cardX, y, cardX + cardW, y, r)
    ctx.closePath()
    ctx.clip()
    drawImageCover(ctx, cover, cardX, y, cardW, coverH)
    ctx.restore()
    y += coverH
  }

  y += innerPad
  const leftX = cardX + innerPad

  // 头像行
  const avR = 32
  drawAvatar(ctx, avatar, leftX + avR, y + avR, avR, input.author)
  ctx.textAlign = "left"
  ctx.textBaseline = "middle"
  ctx.fillStyle = "#ffffff"
  ctx.font = font(600, 28)
  ctx.fillText(input.author, leftX + avR * 2 + 18, y + avR - 9)
  ctx.fillStyle = "rgba(255,255,255,0.5)"
  ctx.font = font(400, 20)
  ctx.fillText("分享了一条动态", leftX + avR * 2 + 18, y + avR + 17)
  y += 64 + 26
  ctx.textBaseline = "alphabetic"

  // 标题
  if (titleLines.length) {
    ctx.fillStyle = "#ffffff"
    ctx.font = font(700, 34)
    for (const ln of titleLines) {
      y += titleLH
      ctx.fillText(ln, leftX, y - 12)
    }
    y += 10
  }

  // 正文
  ctx.fillStyle = "rgba(255,255,255,0.86)"
  ctx.font = font(400, 27)
  for (const ln of bodyLines) {
    y += bodyLH
    ctx.fillText(ln, leftX, y - 12)
  }

  await drawQRBlock(ctx, input.url, M, footerTop, "扫码访问", "来萤火虫之国看看")

  return canvas.toDataURL("image/png")
}

// ============================ 音乐海报 ============================
async function generateMusicPoster(input: ShareMusicInput): Promise<string> {
  const coverSize = 460
  const coverX = (W - coverSize) / 2
  const coverTop = 150
  const hue = input.hue ?? null
  const cardX = 48
  const cardW = W - cardX * 2
  const innerPad = 32
  const cardTop = 116

  const coverRaw = input.coverUrl ? neteaseDirectCover(input.coverUrl) : null
  const [logo, cover] = await Promise.all([loadImage("/logo.png"), loadImage(coverRaw)])

  const m = document.createElement("canvas").getContext("2d")!
  m.font = font(700, 40)
  const titleLines = wrapLines(m, input.title || "未知曲目", cardW - innerPad * 2, 2)

  // 垂直布局（绘制前定好，画布高度需先确定）
  const titleLH = 54
  const titleY0 = coverTop + coverSize + 56 // 第一行歌名基线
  const afterTitle = titleY0 + titleLines.length * titleLH
  const artistY = afterTitle + 4
  const waveY = afterTitle + 56 // 波形中线
  const footerTop = waveY + 84
  const cardBottom = footerTop + 178 + 28
  const H = cardBottom + 44

  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext("2d")!

  // 封面作模糊底图 → 毛玻璃质感
  paintBackdrop(ctx, H, hue, cover)
  await drawBrand(ctx, logo)

  // 毛玻璃内容卡
  drawGlassPanel(ctx, cardX, cardTop, cardW, cardBottom - cardTop, 32)

  // 封面：辉光 + 圆角
  const glowRGB = hue == null ? "163,230,53" : hslToRgbStr(hue, 75, 60)
  ctx.save()
  ctx.shadowColor = `rgba(${glowRGB},0.55)`
  ctx.shadowBlur = 60
  ctx.shadowOffsetY = 16
  ctx.fillStyle = "#000"
  roundRect(ctx, coverX, coverTop, coverSize, coverSize, 32)
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundRect(ctx, coverX, coverTop, coverSize, coverSize, 32)
  ctx.clip()
  if (cover) {
    drawImageCover(ctx, cover, coverX, coverTop, coverSize, coverSize)
  } else {
    // 无封面：hue 渐变兜底 + 音符
    const g = ctx.createLinearGradient(coverX, coverTop, coverX + coverSize, coverTop + coverSize)
    g.addColorStop(0, `hsl(${hue ?? 90} 60% 32%)`)
    g.addColorStop(1, `hsl(${(hue ?? 90) + 40} 50% 14%)`)
    ctx.fillStyle = g
    ctx.fillRect(coverX, coverTop, coverSize, coverSize)
    ctx.fillStyle = "rgba(255,255,255,0.35)"
    ctx.font = font(400, 140)
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("♪", W / 2, coverTop + coverSize / 2 + 6)
  }
  ctx.restore()
  ctx.strokeStyle = "rgba(255,255,255,0.14)"
  ctx.lineWidth = 1.5
  roundRect(ctx, coverX, coverTop, coverSize, coverSize, 32)
  ctx.stroke()

  // 歌名（居中）
  ctx.textAlign = "center"
  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = "#ffffff"
  ctx.font = font(700, 40)
  titleLines.forEach((ln, i) => {
    ctx.fillText(ln, W / 2, titleY0 + i * titleLH)
  })

  // 歌手
  ctx.fillStyle = "rgba(255,255,255,0.6)"
  ctx.font = font(400, 26)
  ctx.fillText(input.artist || "未知歌手", W / 2, artistY)

  // 装饰波形（品牌色 / 封面主色）
  const waveColor = hue == null ? LIME : `hsl(${hue} 80% 62%)`
  ctx.strokeStyle = waveColor
  ctx.globalAlpha = 0.85
  ctx.lineWidth = 4
  ctx.lineCap = "round"
  const waveW = 280
  const waveX = (W - waveW) / 2
  const bars = 28
  ctx.beginPath()
  for (let i = 0; i < bars; i++) {
    const bx = waveX + (i / (bars - 1)) * waveW
    // 固定包络（中间高两端低）+ 正弦起伏，确定性、可复现
    const env = Math.sin((i / (bars - 1)) * Math.PI)
    const amp = 6 + env * 26 * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7)))
    ctx.moveTo(bx, waveY - amp)
    ctx.lineTo(bx, waveY + amp)
  }
  ctx.stroke()
  ctx.globalAlpha = 1

  await drawQRBlock(ctx, input.url, cardX + innerPad, footerTop, "扫码听歌", "在萤火虫之国播放")

  return canvas.toDataURL("image/png")
}

/** 生成分享海报，返回 PNG data URL。 */
export async function generatePoster(input: ShareInput): Promise<string> {
  if (input.kind === "music") return generateMusicPoster(input)
  return generatePostPoster(input)
}
