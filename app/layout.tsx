import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "萤火虫之国",
  description: "分享想法 · 探索音乐",
  keywords: ["萤火虫之国", "论坛", "音乐"],
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
      <body
        className={`${inter.className} relative bg-transparent`}
        style={{
          backgroundImage: `url('${BG_IMAGE}')`,
          backgroundSize: "cover",
          backgroundPosition: "center center",
          backgroundRepeat: "no-repeat",
          backgroundAttachment: "fixed",
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
