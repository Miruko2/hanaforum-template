"use client"

// 聊天室「入口 ↔ 面板」共享状态。
// 入口（导航栏图标 + 未读红点）和面板（floating-chat）是两个相距很远的组件，
// 用一个轻量 Context 共享 open / unread：
//   - 导航栏：读 unread 显示红点、调 setOpen(true) 打开面板
//   - floating-chat：读 open 决定渲染、把私聊未读总数写回 setUnread
import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"

type ChatUIValue = {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  toggle: () => void
  unread: number
  setUnread: Dispatch<SetStateAction<number>>
}

const ChatUIContext = createContext<ChatUIValue | null>(null)

export function ChatUIProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const toggle = () => setOpen((o) => !o)
  return (
    <ChatUIContext.Provider value={{ open, setOpen, toggle, unread, setUnread }}>
      {children}
    </ChatUIContext.Provider>
  )
}

// 容错：没有 Provider 包裹时返回安全空实现，组件不会崩（例如某些独立渲染场景）。
export function useChatUI(): ChatUIValue {
  const ctx = useContext(ChatUIContext)
  if (!ctx) {
    return { open: false, setOpen: () => {}, toggle: () => {}, unread: 0, setUnread: () => {} }
  }
  return ctx
}
