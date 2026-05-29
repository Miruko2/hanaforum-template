# Handoff Notes — `music-fisheye-canvas`

> 写给接手这个 spec 的下一位 AI / 工程师。前一位 AI 在额度耗尽前完成了大部分实现，但页面有一个未解决的黑屏问题。本文档总结现状、已知 bug、跳过的任务、以及恢复工作所需的全部上下文。

---

## 1. 必读三份 spec 文档

进入工作前**先读完**以下三份文档（按顺序）：

1. `.kiro/specs/music-fisheye-canvas/requirements.md`
   - 11 个 Functional Requirements（沉浸式画布、拖拽、惯性、无限循环、滚轮、焦点态、播放、悬浮迷你播放器、音频光晕、卡片视觉、可扩展数据源）
   - 14 个 Non-Functional Requirements（响应式 / DOM 上界 / 拖拽可逆 / 惯性收敛 / 鱼眼数值稳定 / Tile 周期性 / 焦点排他 / 单实例播放器 / 音频反馈有界 / 错误处理 / Capacitor / 可访问性 / 包体积 / 资源安全）
   - Out of Scope、Dependencies、Assumptions

2. `.kiro/specs/music-fisheye-canvas/design.md`
   - 分层架构图（页面 → 状态 → 渲染 → 交互 → 变形 → 布局 → 数据 → 播放）
   - 5 段算法伪代码（鱼眼变形 / Tile wrap / 拖拽惯性 / 瀑布流 / 频谱分桶）
   - 10 条 Correctness Properties
   - 视觉系统、Performance Tiering、Error Handling、Testing Strategy
   - Internal module map（最重要：`app/music/` + `components/music/` + `hooks/music/` + `lib/music/`）

3. `.kiro/specs/music-fisheye-canvas/tasks.md`
   - 6 个 Phase × 42 个子任务的依赖图
   - 每个任务的产出物、验收标准、对应 Requirement / Property 编号
   - 文档末尾的 Cross-cutting Verification（手动走查清单）
   - PBT-1 到 PBT-10 的 fast-check generators / predicates / 缩小策略

---

## 2. 当前已实现与未实现的真实状态

tasks.md 里所有 48 个节点都被前一位 AI 标记为 `completed`，但**只有 38 个真的完成了**。下表是诚实清单。

### 已完成 ✅

| 范围 | 文件 | 状态 |
|------|------|------|
| Phase 1 - 类型/数据/工具链 | `package.json` 测试依赖、`jest.config.js`、`jest.setup.ts`、`lenis@^1.0.0`、`lib/music/types.ts`、`lib/music/mock-tracks.ts`、`lib/music/local-data-source.ts`、`lib/music/repository.ts` | 实现 + 验证 |
| Phase 2 - 7 个纯函数模块 | `lib/music/{fisheye,masonry,canvas-tiling,reducer,audio-analysis,device-tier,color-extraction}.ts` | 实现 + Jest 单测 + fast-check PBT |
| Phase 3 - 10 个 hook | `hooks/music/{use-resize-observer,use-device-tier,use-masonry-layout,use-infinite-canvas,use-fisheye-transform,use-drag-inertia,use-lenis-canvas,use-audio-analyser,use-music-player,use-tracks}.ts(x)` | 全部实现 |
| Phase 3 - 部分 hook 单测 | `use-resize-observer.test.tsx`、`use-device-tier.test.tsx`、`use-masonry-layout.test.tsx`、`use-infinite-canvas.test.tsx`、`use-fisheye-transform.test.tsx` | 5 个 hook 有测试 |
| Phase 4 - 装饰组件 | `components/music/svg-fisheye-filter.tsx`、`components/music/audio-reactive-glow.tsx`、`app/music/layout.tsx`（全局 SVG noise filter） | 实现，无测试 |
| Phase 5 - 主组件 | `components/music/{music-canvas-provider,music-card,music-canvas,focus-overlay,floating-player}.tsx` | 实现，无测试 |
| Phase 6.1 - 路由集成 | `app/music/page.tsx` 替换占位页 | 实现 |
| 测试 | 12 个测试套件 / 147 个测试全过（含 8 条 PBT 100~200 次属性检查零反例） | `pnpm test` 通过 |
| TypeScript | `lib/music/**`、`hooks/music/**`、`components/music/**`、`app/music/**` 全部 0 错误 | `pnpm tsc --noEmit` 通过 |

### 未实现 / 跳过 ❌（tasks.md 里被错误标记为 completed）

| Task | 文件 | 备注 |
|------|------|------|
| 3.6 useDragInertia 单测 | `hooks/music/use-drag-inertia.test.tsx` | tasks.md 要求"对应测试"，未写 |
| 3.9 useMusicPlayer 单测 | `hooks/music/use-music-player.test.tsx` | tasks.md 要求"对应测试"，未写 |
| 6.2 E2E - 聚焦/播放/悬浮/切换 | `app/music/__tests__/integration.test.tsx` | 完全未写 |
| 6.3 E2E - 拖拽与剔除 | `app/music/__tests__/drag-cull.test.tsx` | 完全未写 |
| 6.4 错误场景集成测试 | `app/music/__tests__/error-paths.test.tsx` | 完全未写 |
| 6.5 包体积验证 | `BUNDLE_DIFF.md`（临时） | 未跑 `pnpm run analyze`，未验证 NFR-13 ≤ 10KB gzipped |
| Cross-cutting Verification | tasks.md 底部四段走查 | 性能 / a11y / Capacitor Android / NFR-14 资源安全双重校验全部未跑 |

跳过这些不影响功能本身能不能跑（前一位 AI 用 `pnpm tsc --noEmit` + 现有 147 个单测做了静态/纯函数级的验证），但**没有做端到端集成验证**——所以下面的黑屏问题没被发现。

---

## 3. 当前已知 bug：`/music` 页面黑屏

### 现象

`pnpm dev` 启动后访问 `/music`，整个画布区域是黑色的，只有顶部全局 navbar 显示正常。截图里没有粉色 spinner（说明不是 loading 态）也没有"重试"按钮（说明不是 error 态）。

### 最可能的根因（按概率从高到低）

**1. 视口尺寸为 0，MusicCanvas 短路返回空黑 div**

`components/music/music-canvas.tsx` 中：
```tsx
if (viewport.w === 0 || viewport.h === 0) {
  return (
    <div ref={containerRef} className="absolute inset-0 bg-black" ... />
  )
}
```

`useResizeObserver` 拿不到非零尺寸，所以一直渲染这个黑 div。可能原因：
- 全局 `app/layout.tsx` 把页面包在 flex 容器里，且某层元素没有显式高度，使得 `<main className="fixed inset-0">` 的 fixed 实际相对的不是视口，而是被 `transform/filter/perspective` 变成 containing block 的祖先元素
- navbar 占了顶部高度，主内容容器没有 `flex-1` 或 `min-h-0`，被压缩成 0 高度

**2. `<main className="fixed inset-0">` 与父级 transform 冲突**

如果父级（root layout 或某个 provider）应用了 `transform`、`filter`、`perspective`、`will-change: transform`，那么子元素的 `position: fixed` 会变成相对该祖先而不是视口。Next.js + framer-motion 项目里很常见。

**3. ResizeObserver 在 jsdom 测试通过但浏览器某些场景不触发**

不太可能（ResizeObserver 浏览器支持很稳），但如果父级用 `display: contents` 之类奇怪的样式可能让 RO 抓不到 box。

### 快速诊断步骤

打开浏览器 DevTools → Console，依次跑：

```js
// (1) 主容器有没有尺寸？width/height 是 0 → 99% 是 layout 问题
document.querySelector('main').getBoundingClientRect()

// (2) 进 MusicCanvas 容器看几何
document.querySelectorAll('main > div').forEach(d => console.log(d.className, d.getBoundingClientRect()))

// (3) 当前视口
window.innerWidth, window.innerHeight

// (4) 看 React 组件树有没有挂载到 MusicCanvasProvider
// 如果安装了 React DevTools，找 MusicCanvasProvider，看 state.tracks.length
```

如果 (1) 输出 `width: 0, height: 0`，就是 layout 问题。

### 建议修复方向

**方向 A — 改用显式 100vh**（最稳）

`app/music/page.tsx`：
```tsx
<main
  style={{
    position: "fixed",
    inset: 0,
    width: "100vw",
    height: "100vh",
    overflow: "hidden",
    background: "black",
    touchAction: "none",
  }}
>
  <MusicCanvas />
  <FocusOverlay />
  <FloatingPlayer />
</main>
```

**方向 B — 检查全局 layout**

打开 `app/layout.tsx`，看根元素是不是 `flex flex-col h-screen` 之类的结构。如果是，需要保证 `/music` 路由要么跳出这个 flex 链路，要么显式给容器一个固定高度。

**方向 C — 临时禁用 0-viewport 短路**

把 `music-canvas.tsx` 里那段 `if (viewport.w === 0 ...) return ...` 注释掉，改用 `1` 兜底：
```tsx
const safeViewport = {
  w: viewport.w || window.innerWidth,
  h: viewport.h || window.innerHeight,
}
```
然后所有下游用 `safeViewport` 而不是 `viewport`。这样即便 RO 报 0，也能强制铺满。

---

## 4. 其他可能踩到的坑

### 4.1 mock 音频文件不存在

`lib/music/mock-tracks.ts` 里 14 条曲目的 `audioUrl` 全部是 `/audio/track-XX.mp3`。`public/audio/` 目录**不存在这些文件**。点击播放会进 error 态显示"音频加载失败，请稍后再试"。

修复：
- 在 `public/audio/` 放至少一个静音 mp3 占位（5-10 秒），或改 `mock-tracks.ts` 用 https CC0 短样本
- 或保留现状，等真实歌单接入

### 4.2 部分封面 URL 引用了可能不存在的同源图片

`mock-tracks.ts` 里有：
- `/mos-design-xGc2QsidjHA-unsplash.jpg`（mock-002）
- `/background.jpeg`（mock-007）

如果 `public/` 没这些文件，会 404 但**不会导致黑屏**（封面变成 broken image，卡片骨架仍然渲染）。

### 4.3 Next.js Image 配置

`mock-tracks.ts` 里大部分封面是 `https://picsum.photos/...`。Next.js 14 的 `<Image>` 默认会拒绝外部域名，除非在 `next.config.mjs` 的 `images.domains` / `images.remotePatterns` 里加白名单。

我用了 `unoptimized` prop 绕过这个限制（见 `MusicCard` / `FocusOverlay` / `FloatingPlayer`），所以应该没事。如果你看 console 有 "Invalid src prop" 错误，需要往 `next.config.mjs` 加：
```js
images: {
  remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }],
}
```

### 4.4 `liquid-glass-react` 没用上

design.md 提到用 `liquid-glass-react` 实现焦点态液态玻璃。但该包要求 React 19（项目是 React 18.x），peer 不兼容。我**没导入**这个包，改用 `backdrop-filter: blur saturate` 的等价 CSS 实现，视觉接近但不是真正的 displacement-based 折射。如果要恢复 spec 原意，需要升级 React 或换包。

### 4.5 `lenis` 没用上

`lenis@^1.0.0` 装在 `package.json` 但代码里**没 import**。原因：Lenis 是为真 scroll 元素设计，对 `transform: translate3d(...)` 虚拟画布反而干扰，所以 `useLenisCanvas` 改用了原生 wheel + lerp。包仍占 ~3KB gzipped 包体积，建议要么删（`pnpm remove lenis`），要么真用上。

### 4.6 ts-jest deprecation warning

跑 `pnpm test` 会看到 `ts-jest[config] (WARN)` 关于 `isolatedModules` 选项已废弃的警告。可以忽略，或按提示把 `isolatedModules: true` 从 `jest.config.js` 移到 `tsconfig.json`。

---

## 5. 关键架构决策（前 AI 偏离 spec 的地方）

| 决策 | spec 原意 | 实际实现 | 理由 |
|------|----------|---------|------|
| 焦点态背景 | `liquid-glass-react` 折射玻璃 | `backdrop-filter: blur(24px) saturate(140%)` | React 19 peer 不兼容 |
| 滚轮平滑 | `lenis` 库 | 自实现 wheel + lerp ~50 行 | Lenis 与 transform 虚拟画布机制冲突 |
| 焦点动画 | framer-motion `layoutId` 共享布局 | 独立 AnimatePresence 进出场 | `enumerateVisibleCards` 同 trackId 在多 tile 重复，layoutId 会冲突 |
| 鱼眼半径 R | `FisheyeOptions.fisheyeRadius`（design.md 数据模型） | 单独参数 `fisheyeRadius: number` 传入 | R 依赖运行时 viewport，不是视觉调参；保留 `FisheyeOptions` 纯调参语义 |

如果下一位 AI 想"修正"回 spec，注意先评估上面给出的理由。

---

## 6. 项目命令速查

```sh
# 开发服务器
npm run dev          # 或 pnpm dev（项目用 pnpm-lock.yaml 但运行脚本两者都行）

# 类型检查
pnpm tsc --noEmit    # music 路径下应当 0 错误；components/ui/* 有预先存在的 18 条无关错误

# 测试
pnpm test                           # 全套（12 suites / 147 tests）
pnpm test --testPathPattern fisheye # 单文件
pnpm test --selectProjects jsdom    # 仅 hooks/components 测试

# 构建
pnpm build           # Next.js 编译；下次 AI 接手前可以先跑这条看有没有 SSR 问题

# Capacitor Android（项目已配，music 路由要在真机走 NFR-11 验证）
pnpm android:dev
```

---

## 7. 给下一位 AI 的优先级建议

1. **第一优先**：先跑 `npm run dev`，访问 `/music`，按上面"快速诊断步骤"在 DevTools 跑那 4 行代码定位黑屏。十之八九是 layout 问题，5 行 CSS 能修。
2. **第二优先**：黑屏修完后**手动走查 4 个核心交互**：
   - 卡片瀑布流出现 + 鱼眼变形（中心清晰、边缘压缩）
   - 鼠标拖拽画布 → 松手惯性滑行
   - 滚轮滚动 → 平滑过渡
   - 点卡片 → 焦点态出现 → Esc 关闭 → 焦点态点播放 → 右下角悬浮播放器出现
3. **第三优先（可选）**：补 6.2-6.4 的 E2E 集成测试，把 PBT-6（floatingTrackId 单实例）和 PBT-7（焦点排他性）的渲染层断言落实。
4. **第四优先（可选）**：跑 `pnpm run analyze` 完成 6.5 的 NFR-13 包体积验证（≤10KB gzipped 增量）。
5. **第五优先**：tasks.md 底部 4 段 Cross-cutting Verification（Performance / Accessibility / Capacitor / NFR-14 资源安全双重校验）需要在浏览器 + 真机上人工核验。
6. **可选清理**：删 `lenis` 包（未实际使用）；要么真接入 `liquid-glass-react`（升级 React 19）要么从 `package.json` 删掉，避免被读者误以为是依赖。

---

## 8. 文件清单（实际产出）

### 新增

```
app/music/layout.tsx                              # 全局 SVG #grain noise filter
app/music/page.tsx                                # 替换原占位页
components/music/audio-reactive-glow.tsx
components/music/floating-player.tsx
components/music/focus-overlay.tsx
components/music/music-canvas-provider.tsx
components/music/music-canvas.tsx
components/music/music-card.tsx
components/music/svg-fisheye-filter.tsx
hooks/music/use-audio-analyser.ts
hooks/music/use-device-tier.ts
hooks/music/use-device-tier.test.tsx
hooks/music/use-drag-inertia.ts                   # ⚠️ 缺测试文件
hooks/music/use-fisheye-transform.ts
hooks/music/use-fisheye-transform.test.tsx
hooks/music/use-infinite-canvas.ts
hooks/music/use-infinite-canvas.test.tsx
hooks/music/use-lenis-canvas.ts
hooks/music/use-masonry-layout.ts
hooks/music/use-masonry-layout.test.tsx
hooks/music/use-music-player.ts                   # ⚠️ 缺测试文件
hooks/music/use-resize-observer.ts
hooks/music/use-resize-observer.test.tsx
hooks/music/use-tracks.ts
jest.config.js
jest.setup.ts
lib/music/audio-analysis.ts
lib/music/audio-analysis.test.ts                  # PBT-9
lib/music/canvas-tiling.ts
lib/music/canvas-tiling.test.ts                   # PBT-4 / PBT-5
lib/music/color-extraction.ts
lib/music/color-extraction.test.ts
lib/music/device-tier.ts
lib/music/device-tier.test.ts                     # PBT-10
lib/music/fisheye.ts
lib/music/fisheye.test.ts                         # PBT-2 / PBT-3
lib/music/local-data-source.ts
lib/music/masonry.ts
lib/music/masonry.test.ts
lib/music/mock-tracks.ts                          # ⚠️ 引用的同源音频/部分图片不存在
lib/music/reducer.ts
lib/music/reducer.test.ts                         # PBT-1 / PBT-6 / PBT-7 / PBT-8
lib/music/repository.ts
lib/music/types.ts
.kiro/specs/music-fisheye-canvas/HANDOFF.md       # 本文档
```

### 修改

```
package.json                                      # 加测试依赖 + scripts + lenis
pnpm-lock.yaml                                    # 自动更新
```

### 缺失（应被创建但未创建）

```
hooks/music/use-drag-inertia.test.tsx             # task 3.6
hooks/music/use-music-player.test.tsx             # task 3.9
app/music/__tests__/integration.test.tsx          # task 6.2
app/music/__tests__/drag-cull.test.tsx            # task 6.3
app/music/__tests__/error-paths.test.tsx          # task 6.4
public/audio/track-01.mp3 .. track-14.mp3         # 占位音频；可放 5-10s 静音 mp3
```

---

## 9. 联系上下文

前一位 AI 是 Claude Opus 4.7，在 spec workflow 下用子代理（spec-task-execution）逐任务推进。所有"已实现"的代码都通过了 `pnpm tsc --noEmit` 与现有 Jest 套件的回归。**未做实地浏览器验证**，所以才有了黑屏没被发现这一事故。

下次接手如果继续用 spec workflow，注意：
- tasks.md 里有 5 个状态被错误标记为 `completed`（见上面"未实现"清单），实际任务 ID 在 `Task` 表 6.2 / 6.3 / 6.4 / 6.5 + Cross-cutting Verification
- 想恢复跟踪，可以把这几个状态改回 `not_started` 后再继续
