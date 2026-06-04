import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "萤火虫之国",
  description: "分享想法 · 探索音乐",
  keywords: ["萤火虫之国", "论坛", "音乐"],
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
        {/* 安卓设备性能降级开关：在 body 渲染前同步给 <html> 打 android-lite 标记，
            供 globals.css 关闭实时毛玻璃模糊等高开销特效（iOS / iPadOS / 桌面不受影响）。
            必须内联同步执行，避免「先渲染毛玻璃再变纯色」的闪烁。 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(/Android|Harmony/i.test(navigator.userAgent)){document.documentElement.classList.add('android-lite')}}catch(e){}`,
          }}
        />
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
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
