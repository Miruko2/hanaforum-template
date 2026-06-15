// 邮箱验证门禁的轻量全局总线。
//
// 目的：把「是否需要先验证邮箱」与「唤起验证弹窗」解耦，实现懒触发——
// 注册完 / 平时浏览都不弹验证窗，只有用户真正要发言（发帖、发弹幕）时，
// 写入口在提交前调用 guardVerify() 才弹，避免弹窗在注册后自动炸出来打扰。
//
// 判定的唯一来源是 EmailVerifyGate：它查库后用 setVerifyNeeded() 写入这里；
// 各写入口只管在提交前调 guardVerify()，不必各自查库。
// DB 触发器（block_unverified_write）仍是最终兜底拦截。

/** 唤起验证弹窗的全局事件名（EmailVerifyGate 监听，guardVerify 派发）。 */
export const EVG_OPEN_EVENT = "evg:open"

let verifyNeeded = false

/** 由 EmailVerifyGate 在判定后写入（唯一判定来源）。 */
export function setVerifyNeeded(v: boolean) {
  verifyNeeded = v
}

/** 当前登录用户是否仍需先验证邮箱才能发言。 */
export function isVerifyNeeded() {
  return verifyNeeded
}

/** 唤起验证弹窗（仅在此被显式调用时弹，注册完不会自动弹）。 */
export function openVerifyGate() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVG_OPEN_EVENT))
  }
}

/**
 * 写操作（发帖 / 发弹幕等）提交前调用：
 *   需要先验证 → 唤起验证弹窗并返回 true（调用方应中止本次提交）；
 *   否则返回 false（放行）。
 */
export function guardVerify(): boolean {
  if (verifyNeeded) {
    openVerifyGate()
    return true
  }
  return false
}
