// app/links/page.tsx
// 「友情链接」页 —— 与二次元 / ACG 导航站互相推荐、彼此引流。
//
// ⚠️ 本页是「服务端组件」(没有 "use client")：友链作为真实 <a> 渲染进初始 HTML，
//    导航站的收录检查程序和搜索引擎都能直接读到（客户端 JS 动态插入的链接它们读不到，
//    这正是友链互换能被对方核实到的关键）。
// 友链数据来自数据库表 friend_links（不再硬编码）：在 /admin/friend-links 后台可视化
//    增删改 + 一键审核申请上墙。force-dynamic 保证后台改完、下次访问即时生效。
import type { Metadata } from "next"
import { createClient } from "@supabase/supabase-js"
import { Link2, ExternalLink, Heart } from "lucide-react"
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from "@/lib/site-url"
import FriendLinkApplyForm from "./_components/friend-link-apply-form"

export const metadata: Metadata = {
  title: "友情链接",
  description: `${SITE_NAME}的友情链接 —— 与各二次元 / ACG 导航站及同好网站互相推荐、彼此引流。`,
  alternates: { canonical: "/links" },
}

// 友链改库后须实时反映后台改动，故每次请求都拉最新（本页小、查询轻，开销可忽略；仍是 SSR、收录无碍）。
export const dynamic = "force-dynamic"

type FriendLink = {
  id: string
  name: string
  url: string
  description: string | null
  icon_url: string | null
  tag: string | null
  category: "friend" | "nav"
  sort_order: number
}

// 服务端用 anon key 读「可见」友链；公开 RLS 策略只放行 is_visible=true 的行。读失败降级为空列表（页面结构照常）。
async function getFriendLinks(): Promise<FriendLink[]> {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    )
    const { data, error } = await sb
      .from("friend_links")
      .select("id, name, url, description, icon_url, tag, category, sort_order")
      .eq("is_visible", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
    if (error) throw error
    return (data ?? []) as FriendLink[]
  } catch (e) {
    console.error("[/links] 读取友链失败，降级为空列表:", e)
    return []
  }
}

// 本站信息：方便对方站长一键复制，加到他们的友链页
const SELF_INFO: { label: string; value: string }[] = [
  { label: "网站名称", value: SITE_NAME },
  { label: "网站地址", value: SITE_URL },
  { label: "一句简介", value: SITE_DESCRIPTION },
  { label: "Logo", value: `${SITE_URL}/icons/icon-512.png` },
]

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export default async function LinksPage() {
  const links = await getFriendLinks()
  const friendSites = links.filter((l) => l.category === "friend")
  const navSites = links.filter((l) => l.category === "nav")

  return (
    <main className="min-h-screen text-white">
      <div className="container mx-auto max-w-4xl px-4 pt-24 pb-16 space-y-8">
        {/* 标题区 */}
        <div className="links-enter text-center space-y-3">
          <div className="mb-2 inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-lime-500/30 bg-lime-500/15">
            <Link2 className="h-8 w-8 text-lime-400" />
          </div>
          <h1 className="text-3xl font-bold sm:text-4xl">友情链接</h1>
          <p className="mx-auto max-w-xl text-sm text-white/60 sm:text-base">
            这里收录与 <span className="text-lime-400">{SITE_NAME}</span> 互相推荐的二次元 / ACG 导航站与同好网站。欢迎交换友链，一起让流量流动起来 ✨
          </p>
        </div>

        {/* 本站信息：方便对方复制 */}
        <section
          className="links-enter space-y-4 rounded-2xl border border-lime-500/30 bg-black/30 p-6 shadow-xl shadow-lime-500/5 backdrop-blur-xl sm:p-8"
          style={{ animationDelay: "80ms" }}
        >
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt={SITE_NAME} className="h-10 w-10 rounded-xl" />
            <div>
              <h2 className="text-lg font-bold">欢迎交换友链</h2>
              <p className="text-xs text-white/50">把下面这份信息加到你的友链页，再来申请即可</p>
            </div>
          </div>
          <dl className="grid gap-2 text-sm">
            {SELF_INFO.map((row) => (
              <div key={row.label} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <dt className="w-20 flex-shrink-0 text-white/40">{row.label}</dt>
                <dd className="break-all font-mono text-[13px] text-white/80">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 申请友链表单（客户端小岛；页面其余仍是 SSR，友链 <a> 可被收录爬虫读到） */}
        <FriendLinkApplyForm className="links-enter" style={{ animationDelay: "110ms" }} />

        {/* 朋友的小站 —— 真朋友的个人站，平等互链，刻意和导航站分开、放在更显眼的位置 */}
        <section className="space-y-4">
          <div className="links-enter flex items-baseline justify-between" style={{ animationDelay: "150ms" }}>
            <h2 className="text-xl font-bold">朋友的小站</h2>
            <span className="text-xs text-white/30">私交友链</span>
          </div>
          <div className="friend-grid grid grid-cols-1 gap-3 sm:grid-cols-2">
            {friendSites.map((link, i) => (
              <div key={link.id} className="friend-card-wrap h-full">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ animationDelay: `${190 + i * 70}ms` }}
                  className="friend-card links-enter group flex h-full items-center gap-4 rounded-2xl border border-lime-400/20 bg-black/30 p-4 backdrop-blur-xl transition-[border-color,background-color,box-shadow] duration-300 hover:border-lime-400/50 hover:bg-black/40 hover:shadow-[0_16px_40px_rgba(0,0,0,0.45),0_0_24px_rgba(163,230,53,0.18)]"
                >
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-lime-400/30 bg-lime-400/10 text-lime-400">
                    <Heart className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-bold text-white/90 transition-colors group-hover:text-lime-400">
                        {link.name}
                      </span>
                      {link.tag && (
                        <span className="flex-shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40">
                          {link.tag}
                        </span>
                      )}
                    </div>
                    {link.description && <p className="mt-0.5 truncate text-xs text-white/50">{link.description}</p>}
                    <p className="mt-1 truncate text-[11px] text-white/30">{hostOf(link.url)}</p>
                  </div>
                  <ExternalLink className="h-4 w-4 flex-shrink-0 text-white/20 transition-colors group-hover:text-lime-400/70" />
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* 友链网格 */}
        <section className="space-y-4">
          <div className="links-enter flex items-baseline justify-between" style={{ animationDelay: "320ms" }}>
            <h2 className="text-xl font-bold">二次元 · ACG 导航</h2>
            <span className="text-xs text-white/30">{navSites.length} 个站点</span>
          </div>
          <div className="friend-grid grid grid-cols-2 gap-3 sm:grid-cols-3">
            {navSites.map((link, i) => (
              <div key={link.id} className="friend-card-wrap h-full">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ animationDelay: `${360 + Math.min(i, 6) * 40}ms` }}
                  className="friend-card links-enter group flex h-full flex-col rounded-2xl border border-white/10 bg-black/30 p-4 backdrop-blur-xl transition-[border-color,background-color,box-shadow] duration-300 hover:border-lime-400/40 hover:bg-black/40 hover:shadow-[0_16px_40px_rgba(0,0,0,0.45),0_0_24px_rgba(163,230,53,0.14)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold text-white/90 transition-colors group-hover:text-lime-400">
                      {link.name}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-white/20 transition-colors group-hover:text-lime-400/70" />
                  </div>
                  {link.description && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/50">{link.description}</p>
                  )}
                  <p className="mt-auto pt-2 truncate text-[11px] text-white/30">{hostOf(link.url)}</p>
                </a>
              </div>
            ))}
          </div>
        </section>

        {/* 说明 */}
        <p className="links-enter text-center text-xs leading-relaxed text-white/30" style={{ animationDelay: "640ms" }}>
          想和我们换友链？先把上面「本站信息」加到你的网站，再到对应导航站提交本页地址即可。
        </p>
      </div>
    </main>
  )
}
