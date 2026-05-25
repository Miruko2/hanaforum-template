"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Send } from "lucide-react"
import { supabase } from "@/lib/supabaseClient"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { useToast } from "@/hooks/use-toast"
import LiveHostStage from "./live-host-stage"
import {
  TRIGGER_REGEX,
  HANAKO_USERNAME,
  type HanakoEmotion,
} from "@/lib/hanako/constants"

/** 一条弹幕在数据库中的结构 */
interface LiveComment {
  id: string
  user_id: string
  username: string
  content: string
  created_at: string
}

type NeonColor = "cyan" | "green" | "pink" | "yellow" | "red" | "purple" | "orange" | "lime"

interface DisplayComment extends LiveComment {
  colorCls: NeonColor
  prefix: string
  typedChars: number
  done: boolean
  isAI?: boolean
}

const NEON_COLORS: NeonColor[] = ["cyan", "green", "pink", "yellow", "red", "purple", "orange", "lime"]
const USER_COLORS: NeonColor[] = ["cyan", "green", "yellow", "red", "purple", "orange", "lime"]
const PREFIX_POOL: Record<NeonColor, string[]> = {
  cyan: [">>>", "<<<"],
  green: ["///", ">>>"],
  pink: ["###", "<<<"],
  yellow: [":::"],
  red: ["[!]"],
  purple: [":::", "~~~"],
  orange: ["===", "***"],
  lime: ["+++", "---"],
}

function hashColor(str: string, excludePink = false): NeonColor {
  const pool = excludePink ? USER_COLORS : NEON_COLORS
  let h = 0
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) | 0
  return pool[Math.abs(h) % pool.length]
}

function pickPrefix(color: NeonColor, seed: string): string {
  const pool = PREFIX_POOL[color]
  let h = 0
  for (const ch of seed) h = (h * 13 + ch.charCodeAt(0)) | 0
  return pool[Math.abs(h) % pool.length]
}

const MAX_DISPLAY = 100
const MAX_LENGTH = 50
const TYPE_SPEED_MS = 85
const TRANSITION_MS = 550

export default function LiveWallContent() {
  const router = useRouter()
  const { user } = useSimpleAuth()
  const { toast } = useToast()

  // 入场 / 退场状态
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)

  const [comments, setComments] = useState<DisplayComment[]>([])
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [inputFocused, setInputFocused] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  // Hanako AI 状态
  const [hanakoEmotion, setHanakoEmotion] = useState<HanakoEmotion>("neutral")
  const [hanakoReply, setHanakoReply] = useState("")
  const [hanakoThinking, setHanakoThinking] = useState(false)
  const aiPendingRef = useRef(false)
  const userRef = useRef(user)

  // 保持 userRef 最新
  useEffect(() => {
    userRef.current = user
  }, [user])

  // 入场
  useEffect(() => {
    const rafId = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(rafId)
  }, [])

  // 退场
  const handleBack = useCallback(() => {
    if (closing) return
    setClosing(true)
    setTimeout(() => router.push("/"), TRANSITION_MS)
  }, [closing, router])

  // ESC 键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleBack()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleBack])

  const toDisplay = useCallback(
    (c: LiveComment, isNew: boolean): DisplayComment => {
      const isAI = c.username === HANAKO_USERNAME
      const colorCls = isAI ? "pink" as NeonColor : hashColor(c.id, true)
      return {
        ...c,
        colorCls,
        prefix: isAI ? "[AI]" : pickPrefix(colorCls, c.id),
        typedChars: isNew ? 0 : c.content.length,
        done: !isNew,
        isAI,
      }
    },
    [],
  )

  // 触发 AI 回复
  const commentsRef = useRef(comments)
  useEffect(() => {
    commentsRef.current = comments
  }, [comments])

  const triggerAIReply = useCallback(
    async (triggerComment: LiveComment) => {
      if (aiPendingRef.current) return
      const currentUser = userRef.current
      if (!currentUser) return

      aiPendingRef.current = true
      setHanakoThinking(true)

      try {
        const recent = commentsRef.current
          .slice(-50)
          .map((c) => ({ username: c.username, content: c.content }))

        const username =
          currentUser.user_metadata?.username ||
          (currentUser.email ? currentUser.email.split("@")[0] : "匿名")

        const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || ""
        const res = await fetch(`${apiBase}/api/ai-reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: currentUser.id,
            username,
            content: triggerComment.content,
            recentMessages: recent,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          setHanakoEmotion(data.emotion || "neutral")
          setHanakoReply(data.reply || "")
        } else {
          const errData = await res.json().catch(() => ({}))
          if (res.status === 403) {
            const isCloudflareBlock = !errData.error?.includes("白名单")
            toast({
              title: isCloudflareBlock ? "请求被拦截" : "无权限",
              description: isCloudflareBlock
                ? "Cloudflare 安全规则拦截了请求，请检查 Bot Fight Mode 或 WAF 设置"
                : errData.error || "你没有与 hanako 对话的权限，请联系管理员获取",
              variant: "destructive",
            })
          } else if (res.status === 429 && errData.error) {
            toast({
              title: "hanako 正忙",
              description: errData.error,
              variant: "destructive",
            })
          } else {
            toast({
              title: `AI 服务错误 (${res.status})`,
              description: errData.error || "请稍后重试",
              variant: "destructive",
            })
          }
        }
      } catch (err) {
        console.error("[LiveWall] AI 回复请求失败:", err)
      } finally {
        setHanakoThinking(false)
        aiPendingRef.current = false
      }
    },
    [toast],
  )

  // 初次加载
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data, error } = await supabase
        .from("live_comments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(MAX_DISPLAY)
      if (!alive) return
      if (error) {
        console.warn("[LiveWall] 初次拉取失败:", error.message)
        return
      }
      const ordered = (data ?? []).reverse()
      setComments(ordered.map((c) => toDisplay(c as LiveComment, false)))
    })()
    return () => {
      alive = false
    }
  }, [toDisplay])

  // 实时订阅
  useEffect(() => {
    const channel = supabase
      .channel("live_comments_page")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_comments" },
        (payload) => {
          const c = payload.new as LiveComment
          setComments((prev) => {
            if (prev.some((x) => x.id === c.id)) return prev
            const next = [...prev, toDisplay(c, true)]
            return next.length > MAX_DISPLAY
              ? next.slice(next.length - MAX_DISPLAY)
              : next
          })

          // 检查是否需要触发 AI（只对别人的消息触发，自己的在 handleSend 里已触发）
          const currentUser = userRef.current
          if (
            c.username !== HANAKO_USERNAME &&
            TRIGGER_REGEX.test(c.content) &&
            (!currentUser || c.user_id !== currentUser.id)
          ) {
            triggerAIReply(c)
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "live_comments" },
        (payload) => {
          const id = (payload.old as LiveComment).id
          setComments((prev) => prev.filter((c) => c.id !== id))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [toDisplay, triggerAIReply])

  // 打字机推进
  useEffect(() => {
    const hasPending = comments.some((c) => !c.done)
    if (!hasPending) return
    const timer = setInterval(() => {
      setComments((prev) =>
        prev.map((c) => {
          if (c.done) return c
          const next = c.typedChars + 1
          return next >= c.content.length
            ? { ...c, typedChars: c.content.length, done: true }
            : { ...c, typedChars: next }
        }),
      )
    }, TYPE_SPEED_MS)
    return () => clearInterval(timer)
  }, [comments])

  // 自动滚底部
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [comments.length])

  // 发送
  const handleSend = useCallback(async () => {
    const content = input.trim()
    if (!content || sending) return
    if (!user) {
      toast({
        title: "需要登录",
        description: "请登录后再发弹幕",
        variant: "destructive",
      })
      return
    }
    if (content.length > MAX_LENGTH) return

    try {
      setSending(true)
      const username =
        user.user_metadata?.username ||
        (user.email ? user.email.split("@")[0] : "匿名")

      const { error } = await supabase.from("live_comments").insert([
        { user_id: user.id, username, content },
      ])
      if (error) throw error
      setInput("")

      // 如果消息包含 @hanako，直接触发 AI 回复（不等 realtime 回声）
      if (TRIGGER_REGEX.test(content)) {
        triggerAIReply({ id: "", user_id: user.id, username, content, created_at: "" })
      }
    } catch (err: any) {
      console.error("[LiveWall] 发送失败:", err)
      toast({
        title: "发送失败",
        description: err?.message || "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSending(false)
    }
  }, [input, sending, user, toast])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const placeholder = user ? "> 发送弹幕... (Enter 发送)  @hanako 呼叫AI" : "> 登录后发送弹幕"

  // 展示态
  const shown = mounted && !closing

  return (
    <div className={`live-wall-page ${shown ? "live-wall-shown" : ""}`}>
      {/* 纯黑底 + 极淡青色扫描线 */}
      <div className="live-wall-bg-scanlines" aria-hidden />
      <div className="live-wall-bg-vignette" aria-hidden />

      {/* 顶部 */}
      <header className="live-wall-header">
        <button
          type="button"
          onClick={handleBack}
          className="live-wall-back"
          aria-label="返回"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>ESC</span>
        </button>

        <div className="live-wall-title">
          <span className="live-wall-dot" />
          <span className="live-wall-title-main">LIVE · 弹幕墙</span>
          <span className="live-wall-title-sub">FIREFLY NATION</span>
        </div>

        <div className="live-wall-count">
          {comments.length.toString().padStart(2, "0")} / {MAX_DISPLAY}
        </div>
      </header>

      {/* 主体区域：左弹幕 + 右主播 */}
      <div className="live-wall-body">
        {/* 左侧弹幕区 */}
        <main ref={listRef} className="live-wall-feed">
          {comments.length === 0 ? (
            <div className="live-wall-empty">
              <span className="neon-pink">&gt;&gt;&gt;</span>
              <span className="ml-3 opacity-60">等待第一条消息...</span>
              <span className="live-wall-cursor" />
            </div>
          ) : (
            comments.map((c, i) => (
              <div
                key={c.id}
                className={`live-wall-line ${c.isAI ? "live-wall-line-ai" : ""}`}
              >
                <span
                  className={`live-wall-prefix neon-${c.colorCls} flicker-part`}
                  style={{ ["--flicker-delay" as any]: (i * 0.41) % 7 }}
                >
                  {c.prefix}
                </span>
                <span
                  className={`live-wall-user neon-${c.colorCls} flicker-part`}
                  style={{ ["--flicker-delay" as any]: (i * 0.73 + 2.1) % 7 }}
                >
                  &gt;&gt; {c.username}:
                </span>
                <span
                  className={`neon-${c.colorCls} flicker-part`}
                  style={{ ["--flicker-delay" as any]: (i * 1.19 + 4.3) % 7 }}
                >
                  {c.content.slice(0, c.typedChars)}
                  {!c.done && <span className="live-wall-cursor typing" />}
                </span>
              </div>
            ))
          )}
        </main>

        {/* 右侧主播舞台 */}
        <aside className="live-wall-stage">
          <LiveHostStage
            emotion={hanakoEmotion}
            reply={hanakoReply}
            isThinking={hanakoThinking}
          />
        </aside>
      </div>

      {/* 输入框 */}
      <footer className="live-wall-footer">
        <form
          className={`live-wall-input-wrap ${inputFocused ? "is-focused" : ""}`}
          onSubmit={(e) => {
            e.preventDefault()
            handleSend()
          }}
        >
          <span className="live-wall-input-prefix">&gt;</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_LENGTH))}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={!user || sending}
            maxLength={MAX_LENGTH}
            className="live-wall-input"
          />
          <span className="live-wall-input-count">
            {input.length}/{MAX_LENGTH}
          </span>
          <button
            type="submit"
            disabled={!user || sending || !input.trim()}
            className="live-wall-send"
            aria-label="发送"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </footer>
    </div>
  )
}
