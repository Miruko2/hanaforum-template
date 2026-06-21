"use client"

import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "framer-motion"
import { X, Link2, ExternalLink, Copy, Check } from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { FriendLinkMeta } from "@/lib/types"

interface FriendLinkDetailModalProps {
  isOpen: boolean
  onClose: () => void
  /** 友链申请快照（来自通知的 meta 列）；缺失时用 fallbackMessage 回落 */
  data: FriendLinkMeta | null
  /** meta 缺失（老通知 / 实时载荷未带 meta）时回落展示的通知原文 */
  fallbackMessage?: string | null
  createdAt?: string | null
}

/**
 * 友链申请详情弹窗：复用系统公告弹窗(AnnouncementModal)同款磨砂玻璃外壳与入场动画
 * （含「动画期间关 backdrop-filter、跑完再开」的手机端防掉帧处理），把一条友链申请的
 * 全部字段（站名 / 网址 / icon / 简介 / 联系方式 / 时间）完整展示。点击「友链申请」类通知时弹出。
 */
export default function FriendLinkDetailModal({
  isOpen,
  onClose,
  data,
  fallbackMessage,
  createdAt,
}: FriendLinkDetailModalProps) {
  // 打开时锁滚
  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden"
    else document.body.style.overflow = ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [isOpen])

  // 同公告弹窗：动画期间禁用 backdrop-filter，跑完(~220ms)再启用磨砂，避免每帧重采样掉帧
  const [glassReady, setGlassReady] = useState(false)
  useEffect(() => {
    if (isOpen) {
      const t = window.setTimeout(() => setGlassReady(true), 220)
      return () => window.clearTimeout(t)
    } else {
      setGlassReady(false)
    }
  }, [isOpen])

  // icon 加载失败回落到 Link2 图标
  const [iconFailed, setIconFailed] = useState(false)
  // 复制联系方式
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!isOpen) {
      setIconFailed(false)
      setCopied(false)
    }
  }, [isOpen])

  if (typeof document === "undefined") return null

  const siteName = data?.site_name?.trim() || "友链申请"
  const siteUrl = data?.site_url?.trim() || ""
  const iconUrl = data?.icon_url?.trim() || ""
  const description = data?.description?.trim() || ""
  const contact = data?.contact?.trim() || ""
  const time = data?.created_at || createdAt || null
  const hasStructured = !!(siteUrl || contact || description || iconUrl)

  async function copyContact() {
    if (!contact) return
    try {
      await navigator.clipboard.writeText(contact)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 复制失败忽略（无剪贴板权限等） */
    }
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ willChange: "opacity" }}
        >
          {/* 背景遮罩：动画期间不开 backdrop-filter，跑完才上磨砂 */}
          <div
            className="absolute inset-0"
            style={{
              background: glassReady ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.68)",
              backdropFilter: glassReady ? "blur(10px)" : "none",
              WebkitBackdropFilter: glassReady ? "blur(10px)" : "none",
            }}
            onClick={onClose}
          />

          {/* 详情卡片 */}
          <motion.div
            className="relative w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col rounded-2xl border border-white/15 shadow-2xl"
            style={{
              background: glassReady ? "rgba(20, 20, 28, 0.7)" : "rgba(20, 20, 28, 0.88)",
              backdropFilter: glassReady ? "blur(28px) saturate(150%)" : "none",
              WebkitBackdropFilter: glassReady ? "blur(28px) saturate(150%)" : "none",
              willChange: "transform, opacity",
              transform: "translateZ(0)",
            }}
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 4 }}
            transition={{ type: "spring", stiffness: 340, damping: 30, mass: 0.8 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部：站点 icon（或 Link2）+ 站名 */}
            <div className="flex items-start justify-between gap-3 px-6 pt-6 pb-4 border-b border-white/10">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-11 w-11 shrink-0 rounded-full overflow-hidden border border-white/15 bg-lime-400/10 flex items-center justify-center">
                  {iconUrl && !iconFailed ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={iconUrl}
                      alt={siteName}
                      className="h-full w-full object-cover"
                      onError={() => setIconFailed(true)}
                    />
                  ) : (
                    <Link2 className="h-5 w-5 text-lime-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-lime-400 font-medium">友链申请 · 萤火虫之国</p>
                  <h3 className="text-lg font-bold text-white truncate">{siteName}</h3>
                </div>
              </div>
              <button
                onClick={onClose}
                className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/10 transition"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 正文：完整字段 */}
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
              {hasStructured ? (
                <>
                  {siteUrl && (
                    <Field label="网站地址">
                      <a
                        href={siteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-lime-400 hover:text-lime-300 break-all"
                      >
                        {siteUrl}
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </a>
                    </Field>
                  )}
                  {iconUrl && (
                    <Field label="Icon 链接">
                      <a
                        href={iconUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white/70 hover:text-lime-300 break-all"
                      >
                        {iconUrl}
                      </a>
                    </Field>
                  )}
                  {description && (
                    <Field label="简介">
                      <p className="text-white/85 whitespace-pre-wrap break-words">{description}</p>
                    </Field>
                  )}
                  {contact && (
                    <Field label="联系方式">
                      <div className="flex items-center gap-2">
                        <span className="text-white/85 break-all">{contact}</span>
                        <button
                          onClick={copyContact}
                          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/60 hover:text-lime-300 hover:border-lime-400/30 transition"
                          aria-label="复制联系方式"
                        >
                          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          {copied ? "已复制" : "复制"}
                        </button>
                      </div>
                    </Field>
                  )}
                </>
              ) : (
                // meta 缺失：回落展示通知原文
                <p className="text-sm text-white/85 leading-relaxed whitespace-pre-wrap break-words">
                  {fallbackMessage || "（无详情）"}
                </p>
              )}

              {time && <p className="pt-1 text-xs text-white/40">提交时间：{formatDate(time)}</p>}

              <div className="mt-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-white/50">
                想收录就到 <span className="text-lime-400">/links</span> 的{" "}
                <span className="font-mono">FRIEND_SITES</span> 数组手动加一行；本弹窗只是申请详情，不会自动上墙。
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-white/40">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  )
}
