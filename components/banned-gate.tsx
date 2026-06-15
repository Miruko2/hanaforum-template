"use client"

import { type ReactNode } from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import BannedScreen from "@/components/banned-screen"

/**
 * 全站封禁门禁：放在 SimpleAuthProvider 内、其它 Provider 之外。
 * 当前登录账号处于封禁中时，整屏渲染 BannedScreen、不挂载站内任何内容/Provider；
 * 否则原样渲染 children。封禁状态由 SimpleAuthProvider 维护（初次查 + realtime 即时生效）。
 */
export default function BannedGate({ children }: { children: ReactNode }) {
  const { isBanned, banReason, isAdmin } = useSimpleAuth()
  // 管理员豁免：避免误把管理员自己锁在 /admin 外（管理员本就不该被封）
  if (isBanned && !isAdmin) return <BannedScreen reason={banReason} />
  return <>{children}</>
}
