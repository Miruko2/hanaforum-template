"use client"

// 友链申请表单（/links 页的客户端小岛）。
// ⚠️ 页面本体是服务端组件、友链作为真实 <a> 渲染进 HTML 以便收录爬虫读到；
//    本组件只是嵌进去的一个交互岛，不影响整页 SSR。
// 提交 POST /api/friend-link-apply：服务端校验 / 防刷 / 入库 + 通知站长（铃铛 + 邮件）。
import { useState } from "react"
import type { ChangeEvent, CSSProperties, FormEvent } from "react"
import { Send, Loader2, Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

type Status = "idle" | "submitting" | "done" | "error"

type FormState = {
  siteName: string
  siteUrl: string
  iconUrl: string
  description: string
  contact: string
}

const EMPTY: FormState = { siteName: "", siteUrl: "", iconUrl: "", description: "", contact: "" }

export default function FriendLinkApplyForm({
  className,
  style,
}: {
  className?: string
  style?: CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<Status>("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const [form, setForm] = useState<FormState>(EMPTY)
  const [honey, setHoney] = useState("") // 蜜罐：真实用户不填，机器人会填

  const set =
    (k: keyof FormState) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (status === "submitting") return
    if (!form.siteName.trim() || !form.siteUrl.trim() || !form.contact.trim()) {
      setStatus("error")
      setErrorMsg("站名、网址、联系方式为必填")
      return
    }
    setStatus("submitting")
    setErrorMsg("")
    try {
      const res = await fetch("/api/friend-link-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, website: honey }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus("error")
        setErrorMsg(data?.error || "提交失败，请稍后重试")
        return
      }
      setStatus("done")
      setForm(EMPTY)
    } catch {
      setStatus("error")
      setErrorMsg("网络异常，请稍后重试")
    }
  }

  const inputCls =
    "w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white/90 placeholder:text-white/30 outline-none transition focus:border-lime-400/60 focus:bg-white/[0.07]"

  return (
    <section
      className={cn(
        "rounded-2xl border border-white/10 bg-black/30 p-5 backdrop-blur-xl sm:p-6",
        className,
      )}
      style={style}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="text-lg font-bold">申请加入友链</h2>
          <p className="mt-0.5 text-xs text-white/50">
            填好你的网站信息提交，站长收到通知后会人工审核
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-5 w-5 flex-shrink-0 text-white/40 transition-transform duration-300",
            open && "rotate-180",
          )}
        />
      </button>

      {open &&
        (status === "done" ? (
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-lime-400/30 bg-lime-400/10 p-4 text-sm text-lime-300">
            <Check className="h-5 w-5 flex-shrink-0" />
            <span>已收到你的申请，站长审核通过后就会出现在友链里，感谢交换 ✨</span>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-3">
            {/* 蜜罐字段：视觉移出屏幕 + 屏蔽辅助技术 + 不可 Tab，真实用户碰不到 */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              value={honey}
              onChange={(e) => setHoney(e.target.value)}
              style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className={inputCls}
                placeholder="站名 *"
                maxLength={40}
                value={form.siteName}
                onChange={set("siteName")}
              />
              <input
                className={inputCls}
                placeholder="联系方式（邮箱 / QQ / …）*"
                maxLength={80}
                value={form.contact}
                onChange={set("contact")}
              />
            </div>
            <input
              className={inputCls}
              placeholder="网站地址 https://… *"
              maxLength={300}
              inputMode="url"
              value={form.siteUrl}
              onChange={set("siteUrl")}
            />
            <input
              className={inputCls}
              placeholder="网站 icon / logo 链接（选填）"
              maxLength={300}
              inputMode="url"
              value={form.iconUrl}
              onChange={set("iconUrl")}
            />
            <textarea
              className={cn(inputCls, "min-h-[72px] resize-y")}
              placeholder="一句话简介（选填，≤120 字）"
              maxLength={120}
              value={form.description}
              onChange={set("description")}
            />

            {status === "error" && <p className="text-xs text-red-400">{errorMsg}</p>}

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[11px] text-white/30">提交前请先把本站加入你的友链页 🤝</p>
              <button
                type="submit"
                disabled={status === "submitting"}
                className="inline-flex items-center gap-2 rounded-xl border border-lime-400/40 bg-lime-400/15 px-4 py-2 text-sm font-medium text-lime-300 transition hover:bg-lime-400/25 disabled:opacity-60"
              >
                {status === "submitting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {status === "submitting" ? "提交中…" : "提交申请"}
              </button>
            </div>
          </form>
        ))}
    </section>
  )
}
