#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Capacitor 远程加载模式同步脚本：
 *
 * APK 通过 capacitor.config.ts 里配置的 server.url 直接加载线上
 * https://forum.hanakos.cc —— 所以：
 * - 不需要 next build（不跑 Next.js 静态导出）
 * - 不需要挪走 app/api（API 路由完全不参与 APK 构建）
 * - 不需要管 React 多实例 / 类型检查 / Suspense 等"静态导出生态"问题
 *
 * 这个脚本只剩一件事：把占位 capacitor-shell/ 同步到 android 工程
 * （cap sync 校验 webDir 存在 + 把内容复制到 android/app/src/main/assets/public/）
 *
 * 历史：早期版本走"静态导出 → 资源打包进 APK"的路径，代码复杂且踩了一连串坑
 * （pnpm 多 React 实例、useSearchParams Suspense 边界、@types/react 18.3 与 Radix
 * 1.1 类型冲突、Windows EPERM 等等）。改成 server.url 远程加载后这些全部消失。
 *
 * 用法：
 *   npm run build:capacitor                   # 跑这个脚本
 *   cd android && .\gradlew.bat assembleDebug # 打 APK（Windows）
 *   cd android && ./gradlew assembleDebug     # 打 APK（macOS / Linux）
 */
const { execSync } = require("child_process")
const path = require("path")

const ROOT = path.resolve(__dirname, "..")

function run(cmd) {
  console.log(`\n> ${cmd}`)
  execSync(cmd, { stdio: "inherit", cwd: ROOT })
}

try {
  console.log(
    "📲 同步占位资源到 Android 工程（实际运行时由 capacitor.config.ts 里的 server.url 远程加载）",
  )
  run("npx cap sync android")

  console.log("\n✅ 同步完成！")
  console.log("   接下来打包 APK：")
  if (process.platform === "win32") {
    console.log("     cd android")
    console.log("     .\\gradlew.bat assembleDebug")
  } else {
    console.log("     cd android && ./gradlew assembleDebug")
  }
  console.log("   产物路径：android/app/build/outputs/apk/debug/app-debug.apk")
} catch (err) {
  console.error("\n❌ 同步失败：", err.message || err)
  process.exit(1)
}
