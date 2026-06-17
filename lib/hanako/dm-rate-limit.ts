/**
 * 私信 AI（萌萌子）专用并发限流器 —— 与弹幕墙的 rate-limit.ts 完全独立。
 *
 * 为什么单独一套：原 rate-limit.ts 是模块级单例，私信与弹幕墙共享同一组
 * 计数器（USER_MAX_CONCURRENT / GLOBAL_MAX_CONCURRENT），弹幕墙忙时会 429 卡住
 * 私信。萌萌子是独立 AI，不应被 hanako 的弹幕墙调用挤占。
 *
 * 私信并发更宽松：连发多条回复时同一用户会短暂并发，故上限比弹幕墙高。
 */

import {
  DM_USER_MAX_CONCURRENT,
  DM_GLOBAL_MAX_CONCURRENT,
} from "./constants"

/** 每用户当前在飞请求数（私信专用，独立于弹幕墙） */
const userInFlight = new Map<string, number>()

/** 全局当前在飞请求数（私信专用） */
let globalInFlight = 0

/** 检查是否允许本次调用 */
export function checkRateLimit(userId: string): { allowed: boolean; reason?: string } {
  const userCount = userInFlight.get(userId) || 0
  if (userCount >= DM_USER_MAX_CONCURRENT) {
    return { allowed: false, reason: "你有太多请求正在处理，请等上一条回复完成" }
  }
  if (globalInFlight >= DM_GLOBAL_MAX_CONCURRENT) {
    return { allowed: false, reason: "萌萌子正在忙，请稍后再试" }
  }
  return { allowed: true }
}

/** 开始一次调用（计数 +1） */
export function startCall(userId: string) {
  userInFlight.set(userId, (userInFlight.get(userId) || 0) + 1)
  globalInFlight++
}

/** 结束一次调用（计数 -1） */
export function endCall(userId: string) {
  const count = (userInFlight.get(userId) || 0) - 1
  if (count <= 0) {
    userInFlight.delete(userId)
  } else {
    userInFlight.set(userId, count)
  }
  globalInFlight = Math.max(0, globalInFlight - 1)
}

const dmRateLimiter = { checkRateLimit, startCall, endCall }
export default dmRateLimiter
