import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import { headers } from "next/headers"
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

// Capacitor 静态导出（CAPACITOR_BUILD=true）没有请求上下文，不能调用 headers()。
// 该模式与 next.config.mjs 里 output:'export' 由同一个 env 触发，所以此条件自洽：
// 仅静态导出时跳过服务端 UA 检测，export 构建不会因调用 headers() 而报错。
const IS_STATIC_EXPORT = process.env.CAPACITOR_BUILD === "true"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 安卓性能降级标记：服务端按 User-Agent 直出 android-lite 到 <html>。
  // 为什么不只靠客户端 <head> 脚本：App Router 下手写 head 内联脚本执行时机不可靠
  //（Capacitor WebView 实测未生效）。SSR 直出 class 既确定生效，又无「先毛玻璃后变纯色」闪烁。
  // globals.css 的 .android-lite 规则据此关闭实时模糊；iOS / iPad / 桌面 UA 不含 Android，不受影响。
  let htmlClass = ""
  if (!IS_STATIC_EXPORT) {
    const ua = headers().get("user-agent") || ""
    if (/Android|Harmony/i.test(ua)) htmlClass = "android-lite"
  }

  return (
    <html lang="zh-CN" className={htmlClass} suppressHydrationWarning>
      <head>
        {/* 高优先级预加载背景图，让浏览器一开始就把它加入下载队列 */}
        <link rel="preload" href={BG_IMAGE} as="image" fetchPriority="high" />
        {/* 客户端兜底：主路径是上面的服务端注入；此脚本仅在静态导出（无服务端 UA）
            或 SSR 未注入时按 UA 补打 android-lite 标记，与服务端注入幂等。 */}
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
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  )
}
