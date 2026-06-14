"use client"

import PostTimeline from "@/app/user/_components/post-timeline"
import type { Post } from "@/lib/types"

// 个人主页「我的帖子」区块。绝区零风格标题条（呼应胶片绶带转场的视觉语言：
// 斜体粗黑大写英文 + 描边镂空巨字 + lime hazard 斜纹 + 编号系统 + 日文副标），
// 下接复用社交页 TimelineCard 卡面的网格（PostTimeline layout="grid"）。
// 实心暗底 + 双色辉光（不再透出页面背景）；动效全部为挂载后只跑一次的入场
// （裁切滑入 / 斜纹拉开 / 高光扫掠 / 水印漂移）+ 一个廉价 opacity 闪烁点，
// 无位移类常驻无限动画，安卓 WebView 安全。样式见 globals.css 的 .mp-* 段。
export default function MyPosts({ posts, loading }: { posts: Post[]; loading: boolean }) {
  return (
    <section>
      {/* ───── 绝区零式标题条 ───── */}
      <div className="mp-banner relative mb-5 rounded-2xl px-5 py-5">
        {/* 描边镂空巨字水印 */}
        <span aria-hidden className="mp-watermark">
          POSTS
        </span>
        {/* 左侧 lime hazard 斜纹条 */}
        <span aria-hidden className="mp-hazard" />
        {/* 一次性高光扫掠 */}
        <span aria-hidden className="mp-sheen" />

        <div className="relative flex items-end gap-3">
          <h3 className="text-2xl font-black italic tracking-tight text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]">
            MY POSTS
          </h3>
          <span className="mp-fade-up mb-1 inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-lime-400">
            <span aria-hidden className="mp-rec-dot h-1.5 w-1.5 rounded-full bg-lime-400 shadow-[0_0_6px_rgba(163,230,53,0.9)]" />
            投稿 / {posts.length}
          </span>
          <span className="mp-fade-up mb-1 ml-auto font-mono text-[11px] tracking-widest text-white/45">
            Nº 04 ◇
          </span>
        </div>
      </div>

      {/* ───── 帖子网格 ───── */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-white/40">加载中…</div>
      ) : posts.length > 0 ? (
        <PostTimeline posts={posts} layout="grid" selectable />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-16 text-center text-white/40">
          <div className="mb-2 text-4xl">🌱</div>
          <p>还没有发过帖子</p>
        </div>
      )}
    </section>
  )
}
