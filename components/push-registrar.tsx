"use client"

import { useEffect, useRef } from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { initPushNotifications, removePushToken, isNativeApp } from "@/lib/push-notifications"

// 原生 App 内：登录（或换账号）→ 注册 FCM 推送；登出 → 移除本设备 token。
// Web 端整段 no-op（isNativeApp() 为 false 时 init/remove 都直接返回）。
export default function PushRegistrar() {
  const { user } = useSimpleAuth()
  const prevUserId = useRef<string | null>(null)

  useEffect(() => {
    if (!isNativeApp()) return
    const uid = user?.id ?? null

    if (uid && uid !== prevUserId.current) {
      // 登录 / 换账号 → 注册（register() 会用当前会话身份存 token）
      initPushNotifications().catch(() => {})
    } else if (!uid && prevUserId.current) {
      // 登出 → 移除本设备 token（趁会话尚在内存里拿到 token 字符串）
      removePushToken().catch(() => {})
    }
    prevUserId.current = uid
  }, [user?.id])

  return null
}
