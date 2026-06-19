"use client"

import { Suspense, useCallback, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import LoginForm from "@/components/login-form"

/**
 * 登录卡片 + 登录成功后的「高斯模糊消散」过渡。
 *
 * 登录成功时（LoginForm 通过 onSuccess 通知），卡片整体 blur 增大 + 淡出 + 轻微放大，
 * 像一团雾散去；散尽后再硬跳转首页。因 layout 的固定背景层与百叶窗层在登录页 / 首页
 * 完全一致（同一张底图、同一层 overlay），卡片消散后只剩背景，跳转视觉无缝；
 * 首页帖子随后由现有 .post-enter「雾中浮现」(blur 24px → 清晰) 自然接续，
 * 首尾两端的高斯模糊呼应成一段连贯的「登录融入首页」动效。
 */
export default function LoginCard() {
  const [leaving, setLeaving] = useState(false)
  const navigatedRef = useRef(false)

  const router = useRouter()

  const goHome = useCallback(() => {
    if (navigatedRef.current) return
    navigatedRef.current = true
    // 客户端路由（非整页刷新）跳首页：AppBackground 等全站 Provider 不卸载，
    // 登录用户在登录页已渐入的自定义首页背景全程保留，不再「先闪回默认底图、
    // 帖子出现后才重新加载自定义图」。登录态由 onAuthStateChange 自动同步，
    // 无需整页刷新即为最新；走普通 router.push（不经 navigateWithTransition），
    // 不触发丝带 / 3D 翻页转场，保「卡片消散 → 首页帖子雾中浮现」这段动效干净。
    router.push("/")
  }, [router])

  const handleSuccess = useCallback(() => {
    setLeaving(true)
    // 兜底：万一动画完成回调因故未触发，也在动画时长后跳转，避免卡在登录页。
    setTimeout(goHome, 700)
  }, [goHome])

  return (
    <motion.div
      className="w-full max-w-md p-8 rounded-2xl z-10 relative
        bg-black/20 backdrop-blur-lg border border-white/10 shadow-2xl"
      style={{ pointerEvents: leaving ? "none" : "auto" }}
      // 静止态不写 filter：避免常态下 inline filter 废掉卡内子元素的 backdrop-filter；
      // 仅在 leaving 时引入 blur（此刻卡片正在消失，子级毛玻璃失效也不可见）。
      animate={leaving ? { filter: "blur(24px)", opacity: 0, scale: 1.06 } : {}}
      transition={{ duration: 0.6, ease: "easeInOut" }}
      onAnimationComplete={() => {
        if (leaving) goHome()
      }}
    >
      {/* LoginForm 内部用 useSearchParams() 读 ?redirect=...；
          output:'export' 模式下必须包 Suspense，否则 build 报错。 */}
      <Suspense fallback={null}>
        <LoginForm onSuccess={handleSuccess} />
      </Suspense>
    </motion.div>
  )
}
