"use client"

import { useEffect, useState } from "react"
import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { getHomeBackground } from "@/lib/profiles"
import { cdnUrl } from "@/lib/cdn-url"

// 首页背景变更的轻量广播：个人页上传/还原后即时通知全站底图(AppBackground)与 music
// 底图(ImageBackdrop)刷新，无需刷新页面 —— AppBackground 挂在全站、不随路由重挂载，
// 不广播就只能等下次整页加载才重取（这正是「设置完要刷新才更新」的根因）。
// detail.url = 原始 home_background_url（cdnUrl 由 useMyBackgroundUrl 统一施加）；null=已还原。
export const HOME_BG_EVENT = "hanako:home-background-changed"

export function emitHomeBackgroundChanged(url: string | null) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(HOME_BG_EVENT, { detail: { url } }))
}

// 当前登录用户设置的「首页背景」（home_background_url，与个人卡片 banner 的 background_url
// 完全独立），经 cdnUrl 走自有图片 CDN 挡 egress。未登录 / 未设置 / 拉取失败 → null
// （由调用方回落各自默认底图）。进页依赖 user.id 拉取一次（token 刷新不重取）；另监听
// HOME_BG_EVENT 即时刷新。首页/全站底图(AppBackground) 与 music 底图(ImageBackdrop)共用。
export function useMyBackgroundUrl(): string | null {
  const userId = useSimpleAuth().user?.id
  const [url, setUrl] = useState<string | null>(null)

  // 依赖 user.id 拉取一次（首次进页 / 刷新 / 切账号）
  useEffect(() => {
    if (!userId) {
      setUrl(null)
      return
    }
    let alive = true
    getHomeBackground(userId)
      .then((bg) => {
        if (alive) setUrl(bg ? cdnUrl(bg) : null)
      })
      .catch(() => {
        if (alive) setUrl(null)
      })
    return () => {
      alive = false
    }
  }, [userId])

  // 即时刷新：个人页上传/还原后广播 HOME_BG_EVENT，全站底图 / music 底图无需刷新页面即更新。
  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ url: string | null }>).detail
      setUrl(detail?.url ? cdnUrl(detail.url) : null)
    }
    window.addEventListener(HOME_BG_EVENT, onChange)
    return () => window.removeEventListener(HOME_BG_EVENT, onChange)
  }, [])

  return url
}
