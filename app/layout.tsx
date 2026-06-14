import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION } from "@/lib/site-url"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  // 所有相对 URL（OG 图、canonical 等）以此为基准拼成绝对地址，搜索引擎/分享抓取必需
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    // 子页面设了自己的 title 时自动拼成「音乐 · 萤火虫之国」，没设则用 default
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["萤火虫之国", "论坛", "社区", "音乐", "hanakos"],
  // 规范链接：让带 ?category= 等参数的同页都归并到根 URL，避免被判重复内容
  alternates: {
    canonical: "/",
  },
  // 允许收录与跟踪链接（默认即如此，显式写出更清晰、也便于以后按页覆盖）
  robots: {
    index: true,
    follow: true,
  },
  // Google Search Console 所有权验证：渲染成 <meta name="google-site-verification">。
  // 首页虽是客户端渲染，但此 meta 由 layout 服务端注入、始终在初始 HTML 里，验证不受影响。
  verification: {
    google: "z_Fv3TeOE9zHuPKjvq6je00bC3ekqhQ2avyCt3KsEOQ",
  },
  // 社交分享卡片：微信 / Twitter / Telegram 等抓取这里生成带图预览
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    // TODO: 建议换成 1200×630 的专属分享图，目前先复用站点背景图
    images: [{ url: "/mos-background.webp", alt: SITE_NAME }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: ["/mos-background.webp"],
  },
  // PWA 清单：让浏览器把这个站当作可安装的应用
  manifest: "/manifest.webmanifest",
  // iOS 把 Web 当作 app 启动（全屏，无地址栏），与 Android Chrome 走 manifest 不同
  appleWebApp: {
    capable: true,
    title: "萤火虫之国",
    statusBarStyle: "black-translucent",
  },
  icons: {
    // 浏览器 tab favicon：用多尺寸 PNG，浏览器自动挑最匹配的；
    // 老的 /favicon.ico 仍存在作为最终兜底，但 <link rel="icon"> 优先级更高
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-48x48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png", // iOS 主屏图标 (180x180 是 iOS 推荐尺寸)
  },
}

// theme_color 在 viewport 里设，影响系统 UI 着色（手机状态栏 / Chrome 顶栏）
export const viewport: Viewport = {
  themeColor: "#0a0a0a",
}

const BG_IMAGE = "/mos-background.webp"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 高优先级预加载背景图，让浏览器一开始就把它加入下载队列 */}
        <link rel="preload" href={BG_IMAGE} as="image" fetchPriority="high" />
      </head>
      <body className={`${inter.className} relative bg-transparent`}>
        {/* 背景图独立成固定层：视觉等效于 background-attachment:fixed（固定不随内容滚动），
            但作为单独的 position:fixed 合成层，滚动时浏览器只合成、不重绘整张图，
            消除低端安卓「每滚一帧重绘 1.1MB 背景」的卡顿。视觉零变化，全平台受益。
            用 width/height:100% 而非 inset，兼容老安卓 WebView。 */}
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            zIndex: -1,
            backgroundImage: `url('${BG_IMAGE}')`,
            backgroundSize: "cover",
            backgroundPosition: "center center",
            backgroundRepeat: "no-repeat",
          }}
        />
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
