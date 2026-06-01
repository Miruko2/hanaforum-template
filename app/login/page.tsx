import { Suspense } from "react"
import LoginForm from "@/components/login-form"

export default function LoginPage() {
  // 百叶窗效果样式
  const blindsOverlayStyle = {
    position: "fixed" as const,
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundImage: `repeating-linear-gradient(
      0deg,
      rgba(0, 0, 0, 0.15),
      rgba(0, 0, 0, 0.15) 2px,
      rgba(0, 0, 0, 0.03) 2px,
      rgba(0, 0, 0, 0.03) 4px
    )`,
    pointerEvents: "none" as const,
    zIndex: 0,
    backdropFilter: "blur(0.7px)",
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative">
      {/* 百叶窗效果 */}
      <div style={blindsOverlayStyle}></div>

      <div
        className="w-full max-w-md p-8 rounded-2xl z-10 relative
        bg-black/20 backdrop-blur-lg border border-white/10 shadow-2xl
        transition-all duration-300"
      >
        {/* LoginForm 内部用 useSearchParams() 读 ?redirect=...；
            output:'export' 模式下必须包 Suspense，否则 build 报错。 */}
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
