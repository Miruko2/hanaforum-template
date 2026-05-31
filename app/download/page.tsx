// app/download/page.tsx
// 「安装应用」页 —— 主推 PWA（覆盖 iOS + Android + 桌面），APK 作为补充。
// 客户端组件：需要做设备识别 + 监听 beforeinstallprompt 事件。
"use client"

import { useEffect, useState } from "react"
import {
  Smartphone,
  Apple,
  Monitor,
  Download,
  Share,
  PlusSquare,
  CheckCircle2,
  Zap,
  RefreshCw,
  Bell,
} from "lucide-react"
import Navbar from "@/components/navbar"
import BackgroundEffects from "@/components/background-effects"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

// PWA 安装事件类型（标准 Web API，但 TS DOM lib 还没收录）
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

type Platform = "ios" | "android" | "desktop" | "unknown"

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown"
  const ua = navigator.userAgent.toLowerCase()
  // iOS 包括 iPadOS（最新版伪装成 Mac，需要单独判定）
  const isIOS =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  if (isIOS) return "ios"
  if (/android/.test(ua)) return "android"
  return "desktop"
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  // 安卓/桌面：display-mode media query；iOS：navigator.standalone（非标准但只有 iOS 这么搞）
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  )
}

export default function DownloadPage() {
  const { toast } = useToast()
  const [platform, setPlatform] = useState<Platform>("unknown")
  const [alreadyInstalled, setAlreadyInstalled] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    setPlatform(detectPlatform())
    setAlreadyInstalled(isStandalone())

    // 监听 PWA 可安装事件（Android Chrome / 桌面 Chrome 触发，iOS Safari 不触发）
    const onBeforeInstall = (e: Event) => {
      e.preventDefault() // 阻止浏览器默认的安装提示横幅，我们用自己的按钮触发
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstallPrompt(null)
      setAlreadyInstalled(true)
      toast({ title: "安装成功", description: "桌面图标已生成，下次直接点开就行" })
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [toast])

  const handlePwaInstall = async () => {
    if (!installPrompt) return
    setInstalling(true)
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice.outcome === "dismissed") {
        toast({ title: "取消了安装", description: "想装的话再点一次按钮" })
      }
      setInstallPrompt(null)
    } catch (err) {
      console.error("PWA install failed:", err)
    } finally {
      setInstalling(false)
    }
  }

  return (
    <main className="min-h-screen text-white">
      <BackgroundEffects />
      <Navbar />

      <div className="container mx-auto max-w-3xl px-4 pt-24 pb-16 space-y-10">
        {/* 标题区 */}
        <div className="text-center space-y-3">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-lime-500/15 border border-lime-500/30 items-center justify-center mb-2">
            <Smartphone className="w-8 h-8 text-lime-400" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold">
            把<span className="text-lime-400">萤火虫之国</span>装到手机
          </h1>
          <p className="text-white/60 text-sm sm:text-base max-w-xl mx-auto">
            添加到主屏幕后跟原生 app 一样：全屏运行、桌面图标、自动同步最新版本
          </p>
        </div>

        {alreadyInstalled && (
          <div className="rounded-xl border border-lime-500/30 bg-lime-500/10 px-5 py-4 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-lime-400 flex-shrink-0" />
            <p className="text-sm text-lime-200">
              你已经从主屏幕打开了应用，不需要重复安装。
            </p>
          </div>
        )}

        {/* PWA 卡片 —— 主推方案 */}
        <section className="rounded-2xl border border-lime-500/30 bg-black/30 backdrop-blur-xl p-6 sm:p-8 space-y-5 shadow-xl shadow-lime-500/5">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono px-2 py-1 rounded-md bg-lime-500/20 text-lime-300 border border-lime-500/30">
              推荐
            </span>
            <h2 className="text-xl font-bold">添加到主屏幕（PWA）</h2>
          </div>

          {/* 优点速览 */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center text-xs sm:text-sm">
            <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-white/5">
              <Zap className="w-5 h-5 text-lime-400" />
              <span className="text-white/80">秒装无警告</span>
            </div>
            <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-white/5">
              <RefreshCw className="w-5 h-5 text-lime-400" />
              <span className="text-white/80">自动更新</span>
            </div>
            <div className="flex flex-col items-center gap-1 p-3 rounded-lg bg-white/5">
              <Bell className="w-5 h-5 text-lime-400" />
              <span className="text-white/80">支持推送*</span>
            </div>
          </div>

          {/* 设备特定引导 */}
          {platform === "ios" && <IosInstallGuide />}
          {platform === "android" && (
            <AndroidInstallGuide
              installPrompt={installPrompt}
              installing={installing}
              onInstall={handlePwaInstall}
            />
          )}
          {platform === "desktop" && (
            <DesktopInstallGuide
              installPrompt={installPrompt}
              installing={installing}
              onInstall={handlePwaInstall}
            />
          )}
          {platform === "unknown" && (
            <p className="text-sm text-white/60">
              请用手机浏览器打开本页面查看安装方法。
            </p>
          )}

          <p className="text-xs text-white/40 pt-2 border-t border-white/5">
            * 推送通知功能需 iOS 16.4 以上 / Android Chrome 才能开启。
          </p>
        </section>

      </div>
    </main>
  )
}

// ─── iOS 引导（Safari 必须手动操作，没有 beforeinstallprompt） ─────────
function IosInstallGuide() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-white/70">
        <Apple className="w-4 h-4" />
        <span>检测到你在用 iPhone / iPad</span>
      </div>

      <ol className="space-y-3">
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-lime-500/20 text-lime-300 text-sm font-bold flex items-center justify-center">
            1
          </span>
          <div className="text-sm text-white/80 leading-relaxed">
            在 <span className="text-white font-semibold">Safari 浏览器</span> 里打开这个页面
            <p className="text-xs text-white/40 mt-0.5">微信内置浏览器装不了，请右上角"在浏览器中打开"</p>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-lime-500/20 text-lime-300 text-sm font-bold flex items-center justify-center">
            2
          </span>
          <div className="text-sm text-white/80 leading-relaxed">
            点击底部工具栏的 <Share className="w-4 h-4 inline-block -mt-0.5 mx-0.5 text-lime-400" /> <span className="text-white font-semibold">分享按钮</span>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-lime-500/20 text-lime-300 text-sm font-bold flex items-center justify-center">
            3
          </span>
          <div className="text-sm text-white/80 leading-relaxed">
            在弹出菜单里下滑，选 <PlusSquare className="w-4 h-4 inline-block -mt-0.5 mx-0.5 text-lime-400" /> <span className="text-white font-semibold">"添加到主屏幕"</span>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-lime-500/20 text-lime-300 text-sm font-bold flex items-center justify-center">
            4
          </span>
          <div className="text-sm text-white/80 leading-relaxed">
            点右上角 <span className="text-white font-semibold">"添加"</span>，桌面就有图标了
          </div>
        </li>
      </ol>
    </div>
  )
}

// ─── Android 引导 ─────────
function AndroidInstallGuide({
  installPrompt,
  installing,
  onInstall,
}: {
  installPrompt: BeforeInstallPromptEvent | null
  installing: boolean
  onInstall: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-white/70">
        <Smartphone className="w-4 h-4" />
        <span>检测到你在用 Android</span>
      </div>

      {installPrompt ? (
        <>
          <p className="text-sm text-white/80">
            浏览器已确认本站可安装，点下面按钮一键添加到主屏幕：
          </p>
          <Button
            onClick={onInstall}
            disabled={installing}
            className="w-full bg-lime-500 hover:bg-lime-600 text-black h-12 text-base font-semibold"
          >
            {installing ? "安装中..." : "一键安装到主屏幕"}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-white/70">
            没有看到一键安装按钮？说明你的浏览器还没准备好。手动方式：
          </p>
          <ol className="space-y-3">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-lime-500/20 text-lime-300 text-sm font-bold flex items-center justify-center">1</span>
              <span className="text-sm text-white/80">推荐用 <span className="text-white font-semibold">Chrome</span> 或 <span className="text-white font-semibold">Edge</span> 打开（微信/QQ 内置浏览器装不了）</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-lime-500/20 text-lime-300 text-sm font-bold flex items-center justify-center">2</span>
              <span className="text-sm text-white/80">点浏览器右上角 <span className="text-white font-semibold">⋮ 三点菜单</span></span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-7 h-7 rounded-full bg-lime-500/20 text-lime-300 text-sm font-bold flex items-center justify-center">3</span>
              <span className="text-sm text-white/80">选 <span className="text-white font-semibold">"添加到主屏幕"</span> 或 <span className="text-white font-semibold">"安装应用"</span></span>
            </li>
          </ol>
        </>
      )}
    </div>
  )
}

// ─── 桌面引导 ─────────
function DesktopInstallGuide({
  installPrompt,
  installing,
  onInstall,
}: {
  installPrompt: BeforeInstallPromptEvent | null
  installing: boolean
  onInstall: () => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-white/70">
        <Monitor className="w-4 h-4" />
        <span>检测到你在用电脑</span>
      </div>

      {installPrompt ? (
        <>
          <p className="text-sm text-white/80">
            装到桌面后可以像独立应用一样从开始菜单 / Dock 启动：
          </p>
          <Button
            onClick={onInstall}
            disabled={installing}
            className="w-full bg-lime-500 hover:bg-lime-600 text-black h-12 text-base font-semibold"
          >
            {installing ? "安装中..." : "安装到桌面"}
          </Button>
        </>
      ) : (
        <p className="text-sm text-white/70">
          你的浏览器暂时不支持一键安装。建议用 <span className="text-white font-semibold">Chrome</span> 或 <span className="text-white font-semibold">Edge</span> 打开本页面，地址栏右侧会有一个安装图标 <Download className="w-4 h-4 inline-block -mt-0.5 mx-0.5 text-lime-400" /> 点它即可。
        </p>
      )}
    </div>
  )
}
