// app/download/page.tsx
// 「下载应用」页 —— 根据设备类型分流：
//   - iOS  → 引导添加到主屏幕（PWA），Safari 不支持 beforeinstallprompt，只能手动
//   - 安卓 → 直接下载 APK（release 版，由 capacitor 打包）
//   - 桌面 → 引导安装 PWA（开发者自己用，普通用户用不到）
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
  ShieldAlert,
} from "lucide-react"
import Navbar from "@/components/navbar"
import BackgroundEffects from "@/components/background-effects"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabaseClient"

// PWA 安装事件类型（标准 Web API，但 TS DOM lib 还没收录）
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

type Platform = "ios" | "android" | "desktop" | "unknown"

// APK 托管在 Supabase Storage 的 public bucket 「downloads」中。
// 发版流程：
//   1. gradle assembleRelease 产出 android/app/build/outputs/apk/release/app-release.apk
//   2. 把这个文件上传到 Supabase Dashboard > Storage > downloads bucket（同名覆盖）
//   3. 前端代码不用动，用户下次访问本页就拿到最新 APK
//
// getPublicUrl 是纯字符串拼接（不发请求），所以可以放模块顶层；
// public bucket 允许匿名 GET，不需要 token。
const APK_PATH: string = supabase.storage
  .from("downloads")
  .getPublicUrl("app-release.apk").data.publicUrl

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

    // 桌面 Chrome / Edge 触发 beforeinstallprompt；iOS Safari 不触发；
    // 安卓走 APK 下载，也不需要 PWA prompt
    const onBeforeInstall = (e: Event) => {
      e.preventDefault() // 阻止浏览器默认横幅，用自己的按钮触发
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

      <div className="container mx-auto max-w-3xl px-4 pt-24 pb-16 space-y-8">
        {/* 标题区 */}
        <div className="text-center space-y-3">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-lime-500/15 border border-lime-500/30 items-center justify-center mb-2">
            <Smartphone className="w-8 h-8 text-lime-400" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold">
            把<span className="text-lime-400">萤火虫之国</span>装到手机
          </h1>
          <p className="text-white/60 text-sm sm:text-base max-w-xl mx-auto">
            iPhone 添加到主屏幕，Android 直接下载安装包
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

        {/* 根据平台分流到对应卡片 */}
        {platform === "ios" && <IosInstallCard />}
        {platform === "android" && <AndroidDownloadCard />}
        {platform === "desktop" && (
          <DesktopInstallCard
            installPrompt={installPrompt}
            installing={installing}
            onInstall={handlePwaInstall}
          />
        )}
        {platform === "unknown" && (
          <section className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl p-6 sm:p-8">
            <p className="text-sm text-white/60">
              请用手机浏览器打开本页面查看安装方法。
            </p>
          </section>
        )}
      </div>
    </main>
  )
}

// ─── iOS：手动添加到主屏幕（PWA） ───────────────────────────────────────
function IosInstallCard() {
  return (
    <section className="rounded-2xl border border-lime-500/30 bg-black/30 backdrop-blur-xl p-6 sm:p-8 space-y-5 shadow-xl shadow-lime-500/5">
      <div className="flex items-center gap-3">
        <Apple className="w-6 h-6 text-lime-400" />
        <h2 className="text-xl font-bold">添加到主屏幕（iPhone / iPad）</h2>
      </div>

      <p className="text-sm text-white/70 leading-relaxed">
        iOS 不支持下载安装包，但可以把网页添加到主屏幕，使用体验跟原生 app 几乎一样：
        全屏运行、桌面图标、自动跟网页保持同步。
      </p>

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
    </section>
  )
}

// ─── Android：直接下载 APK ──────────────────────────────────────────────
function AndroidDownloadCard() {
  return (
    <section className="rounded-2xl border border-lime-500/30 bg-black/30 backdrop-blur-xl p-6 sm:p-8 space-y-5 shadow-xl shadow-lime-500/5">
      <div className="flex items-center gap-3">
        <Smartphone className="w-6 h-6 text-lime-400" />
        <h2 className="text-xl font-bold">下载 Android 应用</h2>
      </div>

      <p className="text-sm text-white/70 leading-relaxed">
        点下方按钮下载安装包，安装后从桌面图标启动。
      </p>

      {/* 下载按钮：用 <a download> 触发浏览器下载行为 */}
      <a href={APK_PATH} download className="block">
        <Button className="w-full bg-lime-500 hover:bg-lime-600 text-black h-12 text-base font-semibold">
          <Download className="w-5 h-5 mr-2" />
          下载 APK
        </Button>
      </a>

      {/* 安装提示：Android 对未知来源应用有警告，需要用户手动允许 */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-100/90 leading-relaxed space-y-1">
          <p className="font-semibold text-amber-200">关于"未知来源应用"提示</p>
          <p>
            首次安装 Android 会提示"未知来源"，这是正常的（应用没上架 Google
            Play）。点提示里的"设置"或"更多信息"，允许从浏览器安装即可。
          </p>
        </div>
      </div>

      <ol className="space-y-3 pt-2 border-t border-white/5">
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-lime-500/20 text-lime-300 text-sm font-bold flex items-center justify-center">
            1
          </span>
          <span className="text-sm text-white/80">点击上方按钮下载 APK 文件</span>
        </li>
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-lime-500/20 text-lime-300 text-sm font-bold flex items-center justify-center">
            2
          </span>
          <span className="text-sm text-white/80">下载完成后，从通知栏或文件管理器点开 APK</span>
        </li>
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-lime-500/20 text-lime-300 text-sm font-bold flex items-center justify-center">
            3
          </span>
          <span className="text-sm text-white/80">
            按提示允许"未知来源应用"安装权限（每个手机品牌设置位置略有不同）
          </span>
        </li>
        <li className="flex gap-3">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-lime-500/20 text-lime-300 text-sm font-bold flex items-center justify-center">
            4
          </span>
          <span className="text-sm text-white/80">安装完成，从桌面图标启动</span>
        </li>
      </ol>
    </section>
  )
}

// ─── 桌面：PWA 安装（保留给开发者 / 想钉到 Dock 的用户） ────────────────
function DesktopInstallCard({
  installPrompt,
  installing,
  onInstall,
}: {
  installPrompt: BeforeInstallPromptEvent | null
  installing: boolean
  onInstall: () => void
}) {
  return (
    <section className="rounded-2xl border border-lime-500/30 bg-black/30 backdrop-blur-xl p-6 sm:p-8 space-y-5 shadow-xl shadow-lime-500/5">
      <div className="flex items-center gap-3">
        <Monitor className="w-6 h-6 text-lime-400" />
        <h2 className="text-xl font-bold">安装到桌面</h2>
      </div>

      {installPrompt ? (
        <>
          <p className="text-sm text-white/80 leading-relaxed">
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
        <p className="text-sm text-white/70 leading-relaxed">
          你的浏览器暂时不支持一键安装。建议用 <span className="text-white font-semibold">Chrome</span> 或 <span className="text-white font-semibold">Edge</span> 打开本页面，地址栏右侧会有一个安装图标 <Download className="w-4 h-4 inline-block -mt-0.5 mx-0.5 text-lime-400" /> 点它即可。
        </p>
      )}
    </section>
  )
}
