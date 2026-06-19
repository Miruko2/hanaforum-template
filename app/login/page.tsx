import LoginCard from "@/components/auth/login-card"

export default function LoginPage() {
  // 百叶窗效果样式（与首页一致，登录卡片消散后两页背景层无缝衔接）
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

      {/* 登录卡片：含登录成功后的「高斯模糊消散」过渡，再无缝跳转首页 */}
      <LoginCard />
    </div>
  )
}
