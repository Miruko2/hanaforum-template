/**
 * 基于并发数的限流器
 * - 用户级：同一用户最多同时 N 个 AI 请求在飞
 * - 全局级：所有用户共享最多 M 个同时在飞请求
 * 请求进来 +1，完成/失败后 -1
 */

import {
  USER_MAX_CONCURRENT,
  GLOBAL_MAX_CONCURRENT,
} from "./constants"

/** 每用户当前在飞请求数 */
const userInFlight = new Map<string, number>()

/** 全局当前在飞请求数 */
let globalInFlight = 0

/**
 * 检查是否允许本次 AI 调用
 */
export function checkRateLimit(userId: string): { allowed: boolean; reason?: string } {
  // 用户级并发
  const userCount = userInFlight.get(userId) || 0
  if (userCount >= USER_MAX_CONCURRENT) {
    return { allowed: false, reason: "你有太多请求正在处理，请等上一条回复完成" }
  }

  // 全局级并发
  if (globalInFlight >= GLOBAL_MAX_CONCURRENT) {
    return { allowed: false, reason: "hanako 正在忙，请稍后再试" }
  }

  return { allowed: true }
}

/**
 * 开始一次调用（请求进入时调用，计数 +1）
 */
export function startCall(userId: string) {
  userInFlight.set(userId, (userInFlight.get(userId) || 0) + 1)
  globalInFlight++
}

/**
 * 结束一次调用（请求完成/失败时调用，计数 -1）
 */
export function endCall(userId: string) {
  const count = (userInFlight.get(userId) || 0) - 1
  if (count <= 0) {
    userInFlight.delete(userId)
  } else {
    userInFlight.set(userId, count)
  }
  globalInFlight = Math.max(0, globalInFlight - 1)
}

// 默认导出对象，防止生产构建 tree-shaking 丢失命名导出
const rateLimiter = { checkRateLimit, startCall, endCall }
export default rateLimiter
