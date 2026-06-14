"use client"

import PostTimeline from "@/app/user/_components/post-timeline"
import type { Post } from "@/lib/types"

// 个人主页「我的帖子」区块。绝区零风格标题（呼应胶片绶带转场的视觉语言：
// 斜体粗黑大写英文 + 镂空背景巨字 + lime 危险条纹 + 编号系统 + 日文副标），
// 下接复用社交页 TimelineCard 卡面的网格（PostTimeline layout="grid"）。
// 装饰全静态（渐变 / 条纹），无常驻动画，安卓 WebView 安全。
export default function MyPosts({ posts, loading }: { posts: Post[]; loading: boolean }) {
  return (
    <section>
      {/* ───── 绝区零式标题条 ───── */}
      <div className="relative mb-5 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-r from-lime-400/[0.12] via-white/[0.04] to-transparent px-5 py-4">
        {/* 背景镂空巨字（静态、极低透明，撑存在感不抢眼） */}
        <span
          aria-hidden
          className="pointer-events-none absolute -right-3 top-1/2 -translate-y-1/2 select-none text-[5.5rem] font-black italic leading-none tracking-tighter text-white/[0.04]"
        >
          POSTS
        </span>
        {/* 左侧 lime 危险条纹色块 */}
        <span
          aria-hidden
          className="absolute left-0 top-0 h-full w-1.5"
          style={{
            background:
              "repeating-linear-gradient(45deg, #a3e635 0, #a3e635 6px, transparent 6px, transparent 12px)",
          }}
        />
        <div className="relative flex items-end gap-3">
          <h3 className="text-2xl font-black italic tracking-tight text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)]">
            MY POSTS
          </h3>
          <span className="mb-1 text-xs font-medium tracking-wide text-lime-400">
            投稿 / {posts.length}
          </span>
          <span className="mb-1 ml-auto font-mono text-[11px] tracking-widest text-white/40">
            Nº 04 ◇
          </span>
        </div>
      </div>

      {/* ───── 帖子网格 ───── */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-white/40">加载中…</div>
      ) : posts.length > 0 ? (
        <PostTimeline posts={posts} layout="grid" />
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 py-16 text-center text-white/40">
          <div className="mb-2 text-4xl">🌱</div>
          <p>还没有发过帖子</p>
        </div>
      )}
    </section>
  )
}
