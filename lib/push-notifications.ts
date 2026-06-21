"use client"

// 原生推送（FCM）注册：仅在 Capacitor 安卓 App 内生效；Web / SSR 整段静默跳过。
// 流程：申请通知权限 → register() 拿 FCM token → 写入 push_tokens（走 RPC）。
// 点击系统通知 → 跳到对应页面（私信 /chat、通知 /notifications）。
//
// 设计要点：
//  - 监听器只装一次；register() 每次登录都可再调，registration 事件用「当前会话用户」
//    身份存 token，从而正确处理同设备换账号（RPC 内 on conflict 会重挂 user_id）。
//  - 整个模块对 Web 端零副作用：isNativeApp() 为 false 时所有导出都是 no-op。

import { Capacitor } from "@capacitor/core"
import { supabase } from "./supabaseClient"

// ⚠️ 临时总开关：真机 App「登录后闪退」排查期间先停用原生推送注册。
// 现象=App 能开到登录页（启动期 Firebase 初始化没崩）、登录后调 register() 才崩，
// 疑似设备无 Google Play 服务 / FCM 取 token 抛原生异常（JS try/catch 拦不住原生崩溃）。
// 排查清楚后改回 true 并重新部署网页即可恢复，无需重打 APK。
const PUSH_ENABLED = false

let listenersReady = false
let currentToken: string | null = null

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

async function ensureListeners(PushNotifications: typeof import("@capacitor/push-notifications").PushNotifications) {
  if (listenersReady) return
  listenersReady = true

  // 拿到 / 刷新 token → 以当前登录用户身份存库
  await PushNotifications.addListener("registration", async (tok) => {
    currentToken = tok.value
    try {
      await supabase.rpc("register_push_token", { p_token: tok.value, p_platform: "android" })
    } catch (e) {
      console.warn("[push] 存 token 失败", e)
    }
  })

  await PushNotifications.addListener("registrationError", (err) => {
    console.warn("[push] 注册失败", err)
  })

  // 点击系统通知 → 跳转（冷启动也能跳，用整页导航最稳）
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const url = action?.notification?.data?.url
    if (url && typeof url === "string") {
      try {
        window.location.assign(url)
      } catch {
        /* ignore */
      }
    }
  })
}

// 登录后调用：装监听 + 申请权限 + 注册。可安全重复调用。
export async function initPushNotifications(): Promise<void> {
  if (!PUSH_ENABLED) return // 临时停用，排查「登录后闪退」期间不碰原生推送
  if (typeof window === "undefined" || !isNativeApp()) return

  let mod: typeof import("@capacitor/push-notifications")
  try {
    mod = await import("@capacitor/push-notifications")
  } catch {
    return // 插件未装（旧版 APK）→ 静默跳过
  }
  const { PushNotifications } = mod

  await ensureListeners(PushNotifications)

  try {
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions()
    }
    if (perm.receive !== "granted") return // 用户拒绝授权 → 不注册
    await PushNotifications.register() // 触发 registration 事件 → 存 token
  } catch (e) {
    console.warn("[push] 权限/注册异常", e)
  }
}

// 登出时调用：移除本设备 token，避免登出后仍收到上一个账号的推送。
export async function removePushToken(): Promise<void> {
  if (!isNativeApp() || !currentToken) return
  const t = currentToken
  currentToken = null
  try {
    await supabase.rpc("unregister_push_token", { p_token: t })
  } catch {
    /* ignore */
  }
}
