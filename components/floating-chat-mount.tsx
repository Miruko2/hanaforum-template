"use client"

import dynamic from "next/dynamic"

// 浮动聊天室是纯客户端组件（realtime / 鉴权 / window），用 ssr:false 动态加载。
// 这层薄包装是「客户端组件」，所以能在根布局（服务端组件）里安全使用 ssr:false。
const FloatingChat = dynamic(() => import("./floating-chat"), { ssr: false })

export default function FloatingChatMount() {
  return <FloatingChat />
}
