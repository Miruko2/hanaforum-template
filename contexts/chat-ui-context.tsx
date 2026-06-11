"use client"

// 聊天室「入口 ↔ 面板」共享状态。
// 入口（导航栏图标 + 未读红点）和面板（floating-chat）是两个相距很远的组件，
// 用一个轻量 Context 共享 open / unread / 「向某人发起私聊」的请求：
//   - 导航栏：读 unread 显示红点、调 setOpen(true) 打开面板
//   - floating-chat：读 open 决定渲染、把私聊未读总数写回 setUnread；
//     消费 pendingDm（外部请求打开的私聊对象），处理完调 clearPendingDm 清掉
//   - 社交页 /user：点「私聊」按钮 → startDmWith(partner)，打开面板并切到对应 DM
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"

// 发起私聊所需的最小对象（与 floating-chat 的 Partner 对齐）
export type DmTarget = {
  id: string
  username: string
  avatar_url?: string | null
}

type ChatUIValue = {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  toggle: () => void
  unread: number
  setUnread: Dispatch<SetStateAction<number>>
  // 外部（如社交页）请求打开的私聊对象；floating-chat 消费后置空
  pendingDm: DmTarget | null
  // 打开聊天面板并请求切到与某人的私聊
  startDmWith: (target: DmTarget) => void
  // floating-chat 处理完 pendingDm 后调用，避免重复触发
  clearPendingDm: () => void
}

const ChatUIContext = createContext<ChatUIValue | null>(null)

export function ChatUIProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [pendingDm, setPendingDm] = useState<DmTarget | null>(null)
  const toggle = () => setOpen((o) => !o)

  const startDmWith = useCallback((target: DmTarget) => {
    setPendingDm(target)
    setOpen(true)
  }, [])
  const clearPendingDm = useCallback(() => setPendingDm(null), [])

  return (
    <ChatUIContext.Provider
      value={{ open, setOpen, toggle, unread, setUnread, pendingDm, startDmWith, clearPendingDm }}
    >
      {children}
    </ChatUIContext.Provider>
  )
}

// 容错：没有 Provider 包裹时返回安全空实现，组件不会崩（例如某些独立渲染场景）。
export function useChatUI(): ChatUIValue {
  const ctx = useContext(ChatUIContext)
  if (!ctx) {
    return {
      open: false,
      setOpen: () => {},
      toggle: () => {},
      unread: 0,
      setUnread: () => {},
      pendingDm: null,
      startDmWith: () => {},
      clearPendingDm: () => {},
    }
  }
  return ctx
}
