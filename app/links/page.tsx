// app/links/page.tsx
// 「友情链接」页 —— 与二次元 / ACG 导航站互相推荐、彼此引流。
//
// ⚠️ 本页刻意做成「服务端组件」(没有 "use client")：友链作为真实 <a> 渲染进初始 HTML，
//    导航站的收录检查程序和搜索引擎都能直接读到（客户端 JS 动态插入的链接它们读不到，
//    这正是友链互换能被对方核实到的关键）。新增/删除友链 = 改下面的数组即可。
import type { Metadata } from "next"
import { Link2, ExternalLink, Heart } from "lucide-react"
import { SITE_NAME, SITE_URL, SITE_DESCRIPTION } from "@/lib/site-url"

export const metadata: Metadata = {
  title: "友情链接",
  description: `${SITE_NAME}的友情链接 —— 与各二次元 / ACG 导航站及同好网站互相推荐、彼此引流。`,
  alternates: { canonical: "/links" },
}

type FriendLink = { name: string; url: string; desc?: string; tag?: string }

// 真朋友的个人站 —— 平等互链、彼此推荐，和「申请收录」性质的导航站完全分开。
// 新增一位朋友 = 往这里加一条。
const FRIEND_SITES: FriendLink[] = [
  { name: "Ar-Sr-Na 主站", url: "https://arsrna.cn/", desc: "创意，从一条时间轴开始", tag: "科技 · 官网" },
  { name: "Ar-Sr-Na", url: "https://www.arirs.cn/", desc: "就是放文章的地方", tag: "前端 · 技术博客" },
]

// 二次元 / ACG 导航站。想申请收录的站点往这里加一条即可。
const ACG_NAV_SITES: FriendLink[] = [
  { name: "萌站·次元导航", url: "https://www.moe321.com/", desc: "ACG 二次元网址导航之门" },
  { name: "ACG 盒子", url: "https://www.acgbox.link/", desc: "专注 ACG 的导航盒子" },
  { name: "ACGN 导航", url: "https://nav.acgn.city/", desc: "AcgN·City 二次元导航" },
  { name: "动漫世界导航", url: "https://nav.acgsq.com/", desc: "一起探索二次元动漫" },
  { name: "终极导航", url: "https://www.zjnav.com/acg", desc: "动漫 · 漫画网站大全" },
  { name: "快导航网", url: "https://www.hifast.cn/acg", desc: "ACG 二次元导航" },
  { name: "AcgnHub 萌导航", url: "https://www.acgfans.me/", desc: "你的二次元萌导航姬" },
  { name: "二次元宝藏导航", url: "https://acg.baozangdh.com/", desc: "可能是国内最好的二次元导航" },
  { name: "万萌导航", url: "https://hao.wanmoe.cn/", desc: "ACG · 二次元导航" },
  { name: "ACG导航站", url: "https://www.acgdhz.com/", desc: "专注 ACG 动漫 · 游戏 · 漫画" },
  { name: "Moe48 萌导航", url: "https://www.moe48.com/", desc: "二次元 · ACG 网址导航" },
]

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

export default function LinksPage() {
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

        {/* 朋友的小站 —— 真朋友的个人站，平等互链，刻意和导航站分开、放在更显眼的位置 */}
        <section className="space-y-4">
          <div className="links-enter flex items-baseline justify-between" style={{ animationDelay: "150ms" }}>
            <h2 className="text-xl font-bold">朋友的小站</h2>
            <span className="text-xs text-white/30">私交友链</span>
          </div>
          <div className="friend-grid grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FRIEND_SITES.map((link, i) => (
              <div key={link.url} className="friend-card-wrap h-full">
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
                    {link.desc && <p className="mt-0.5 truncate text-xs text-white/50">{link.desc}</p>}
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
            <span className="text-xs text-white/30">{ACG_NAV_SITES.length} 个站点</span>
          </div>
          <div className="friend-grid grid grid-cols-2 gap-3 sm:grid-cols-3">
            {ACG_NAV_SITES.map((link, i) => (
              <div key={link.url} className="friend-card-wrap h-full">
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
                  {link.desc && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-white/50">{link.desc}</p>
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
