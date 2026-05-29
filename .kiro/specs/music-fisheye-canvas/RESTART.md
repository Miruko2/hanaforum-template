# Restart — `music-fisheye-canvas` 第二轮

> 第一轮已废弃（CSS 3D transform 路线效果不达标）。第二轮走 **WebGL + R3F**，并用 **anime.js** 做装饰层。
> 这份文档是新会话的入口。开新窗口后第一句话引用 `#RESTART.md` + `#requirements.md` + `#design.md` 即可接上。

---

## 1. 接力上下文：发生了什么

第一轮（前一位 AI 的 Claude Opus 4.7）按 `tasks.md` 完整实现了 42 个子任务的 DOM + CSS 3D transform 方案，TypeScript 0 错误、147/147 单测全过、含 8 条 fast-check PBT 100~200 次属性检查零反例。

**但实地浏览效果与目标差距巨大**：

- 目标视频（参考资料里的截图 / 视频片段）是一面**整体弯曲成穹顶**的密集音乐墙，一屏 50+ 张卡片，强烈球面感 + 暗角 + 蓝色调
- 第一轮实现是稀疏的 DOM 卡片（一屏 3-4 张），鱼眼变形几乎看不出来。即使把 `minScale 0.45 → 0.28`、`rotateStrength 32 → 55`、`curvature → 1.25`、列数翻倍、加 mini-player chrome，**效果仍远不如目标**

**根本原因**：CSS 3D `transform` 是逐元素透视投影，本质是把每张矩形卡片各自做倾斜——卡片**之间**没有共同的弯曲表面。视频里那种"整面墙弯成穹顶"是统一的空间扭曲，必须用：
- WebGL shader（GPU 一次后处理） 或
- SVG `feDisplacementMap`（屏幕级位移，移动端性能不稳）

讨论后选定 **方案 A：WebGL + @react-three/fiber + Three.js**。

---

## 2. 当前清理后的状态（**重要：开干前确认**）

### 已全部删除（42 个文件）

```
app/music/layout.tsx                  ❌ 删
components/music/                     ❌ 整目录删（7 个文件）
hooks/music/                          ❌ 整目录删（15 个文件）
lib/music/                            ❌ 整目录删（18 个文件）
```

### 保留

| 路径 | 内容 | 说明 |
|------|------|------|
| `app/music/page.tsx` | 仅含"音乐 / 即将上线"占位 | 等待新方案重写 |
| `.kiro/specs/music-fisheye-canvas/requirements.md` | 11 个 FR + 14 个 NFR | **可复用**（业务约束没变） |
| `.kiro/specs/music-fisheye-canvas/design.md` | 第一轮的 DOM 设计 | **要重写**（不再是 DOM 路线） |
| `.kiro/specs/music-fisheye-canvas/tasks.md` | 42 个子任务（标记为 completed 但其实指向已删代码） | **要重写**（任务全废） |
| `.kiro/specs/music-fisheye-canvas/HANDOFF.md` | 第一轮交接文档 | **历史归档**，不需要再读 |
| `.kiro/specs/music-fisheye-canvas/RESTART.md` | 本文档 | 新会话入口 |
| `package.json` 测试依赖 | jest/ts-jest/@testing-library/fast-check | 保留，方案 A 仍可写 PBT |
| `package.json` 运行时依赖 | framer-motion@12, lenis, liquid-glass-react, lucide-react, supabase, etc. | 保留，按需取用 |
| `jest.config.js` / `jest.setup.ts` | 双 project 配置（node + jsdom） | 保留 |

### 没有 grep 命中残留引用（已验证）

```
grep -r "@/(lib|hooks|components)/music" --exclude-dir=node_modules → 0 matches
```

---

## 3. 不变的技术栈（项目级约束）

| 类别 | 选择 | 备注 |
|------|------|------|
| 框架 | Next.js 14.0.4 (App Router) | "use client" 边界要注意 |
| React | 18.3.x | **不是 19**——`liquid-glass-react@1.1.1` peer 不兼容 |
| TypeScript | 5.x strict | |
| 样式 | Tailwind 3.3 + tailwindcss-animate | 项目已大量使用 |
| 包管理 | pnpm（pnpm-lock.yaml） | 运行脚本 npm/pnpm 都行 |
| 移动端 | Capacitor Android 5.5 | 同份代码要打安卓 WebView，**WebGL 在 WebView 里要测试性能** |
| 后端 | Supabase（@supabase/ssr + @supabase/supabase-js） | 当前 mock 数据先不接 |
| 字体 | next/font Inter | 不引新字体 |
| 图标 | lucide-react 0.294 | |
| 全局 layout 坑 | `<Providers>` → `PageTransition` 是 `motion.div` 带 `transform`，**会污染 fixed 后代的 containing block** | 上次黑屏元凶；新方案用 `position: fixed; width: 100vw; height: 100vh` inline style 规避 |

---

## 4. 方案 A：WebGL + R3F 技术选型

### 必装新依赖

```bash
pnpm add three @react-three/fiber @react-three/drei animejs
pnpm add -D @types/three
```

**包体积影响**（违反原 NFR-13 的 10KB gzipped 增量约束）：
- `three`: ~150KB gzipped
- `@react-three/fiber`: ~30KB gzipped
- `@react-three/drei`: ~50KB gzipped（按需 tree-shake，常用 ~20KB）
- `animejs` v4: ~10KB gzipped（轻量动画引擎，[anime.js docs](https://animejs.com/documentation/)，rephrased for license compliance）

**总增量约 220KB gzipped**——和原 NFR-13 矛盾。**必须**显式协商：要不要放宽这条 NFR、能否懒加载（动态 import 让 `/music` 之外路由不带）。建议改成"NFR-13: `/music` 路由首屏 JS ≤ 250KB gzipped，且懒加载，不影响其他路由"。

### 可保留的概念资产（来自第一轮的 `lib/music/`，已删但思路可复用）

| 概念 | 第一轮位置 | 方案 A 重用方式 |
|------|----------|----------------|
| `Track` / `MusicCanvasState` 类型 | `lib/music/types.ts` | 重新创建即可，shape 不变 |
| 鱼眼数学公式（`computeFisheyeTransform`） | `lib/music/fisheye.ts` | **写进 GLSL fragment shader 当 uniform 公式** |
| 瀑布流贪心布局（`masonryLayout`） | `lib/music/masonry.ts` | 仍可作为 GPU 纹理图集生成的 UV 坐标 |
| 无限循环 tile（`enumerateVisibleCards`） | `lib/music/canvas-tiling.ts` | 改成 shader 里 `mod(uv, tileSize)` |
| 拖拽惯性（`stepInertia` / `applyDelta`） | `lib/music/reducer.ts` | 仍是纯函数，控制 R3F camera offset |
| 设备能力分级 | `lib/music/device-tier.ts` | 仍是纯函数 |
| 频谱分桶 | `lib/music/audio-analysis.ts` | 仍是纯函数 |
| Repository 模式 | `lib/music/repository.ts` | 不变 |

**所以新方案不是从零开始**——纯函数模块逻辑可以直接平移过去，只是消费方变了（DOM hook → shader uniform / R3F mesh）。

### 高层架构（方案 A）

```
<MusicPage>
 └─ <MusicCanvasProvider>
     └─ <Canvas>                       // R3F Canvas 全屏
         ├─ <PerspectiveCamera />
         ├─ <CardWall />               // 一个曲面 mesh，shader 做球面 UV 偏移
         │    └─ uniforms: { tex, offset, time, bandsBass, ... }
         ├─ <BloomEffect />            // drei postprocessing（可选）
         └─ <RaycastClickPlane />      // 接收点击 → trackId
     <FocusOverlay /> (DOM, 在 Canvas 之上)
     <FloatingPlayer /> (DOM, 在 Canvas 之上)
```

- **CardWall**：单一 mesh，几何用 `PlaneGeometry` 细分（高 segments），shader 在 vertex 阶段把平面顶点投影到球面（或 sphere-cap 子集）
- **纹理图集**：所有卡片预渲染到一张大 texture（用 canvas 2D 画好封面 + 标题 + 进度条 + ▶ 按钮），shader 通过 UV 在图集上采样
- **拖拽**：camera offset 或 mesh translation，复用第一轮 `useDragInertia` 思路（拖拽事件是 Canvas 上的 PointerEvent）
- **点击焦点**：raycaster 把屏幕坐标 → mesh 上的 UV → 反查 trackId
- **音频光晕**：`AnalyserNode` → `splitBands` → 设到 mesh material 的 uniform `bandsBass`，shader 调整边缘 vignette 强度

### anime.js 的角色（装饰层）

不替代 R3F，**和 R3F 协同**：

1. 卡片入场错峰（用 anime.js v4 的 `stagger({ grid: [cols, rows], from: 'center' })` 控制 mesh material 的 `uniforms.entryProgress`）
2. 焦点态时焦点卡片飞到中心：DOM `<FocusOverlay>` 用 anime.js 的 `easeOutElastic`
3. 拖拽松手时的"果冻回弹"装饰
4. 悬浮播放器进出场

参考：[anime.js v4 documentation](https://animejs.com/documentation/)、`stagger` grid 模式（v4.4+）、`createTimeline()`、`createScope({ mediaQueries })`

---

## 5. 三份 Spec 文档怎么处理

| 文档 | 操作 |
|------|------|
| `requirements.md` | **保留 + 微调** | 11 个 FR 全部仍然适用；NFR-13 包体积要重新协商（见上），NFR-2 "可见 DOM 节点上界" 改为 "可见 mesh polygon 上界"，其他不变 |
| `design.md` | **重写** | 当前是 DOM 设计，新方案要重新画架构图 + R3F 组件树 + shader 伪代码 + 纹理图集生成流程 |
| `tasks.md` | **重写** | 第一轮的 42 个任务全部失效；要重新拆 Phase（建议：1. R3F + three 安装与基础 mesh、2. 纹理图集生成、3. shader（球面 UV + 鱼眼 displacement）、4. 拖拽 + raycaster、5. 焦点 + 悬浮 + 音频、6. 集成 + 性能优化） |

---

## 6. 给新 AI 的第一步指令模板

新会话第一句话直接发：

```
读 #.kiro/specs/music-fisheye-canvas/RESTART.md 接管这个 spec。
然后读 requirements.md 确认业务约束没变（除 NFR-13 包体积要重新协商）。
开始执行第一步：装 three / @react-three/fiber / @react-three/drei / animejs，
用 spec workflow 重写 design.md（按方案 A：WebGL + R3F），
完成后等我确认再写 tasks.md。
```

---

## 7. 视频中目标的核心特征（按重要性排序）

如果新 AI 问"视频里到底要什么"，权威答案：

1. **整面墙弯成穹顶**（核心，决定方案选型）：从中心向四周连续弯曲，边缘卡片有真实的透视压缩 + 倾斜，不是逐元素假的
2. **高密度**：一屏 50+ 张卡片，每张约 100×130px 的迷你播放器外观（封面在上，下方半透明黑色控件区含 ⏮ ▶/⏸ ⏭ 三键 + 进度条）
3. **暗角 vignette**：边缘明显比中心暗，强化"看进盒子"的体感
4. **统一冷色调**：整体偏蓝绿，与单卡片 accentColor 不冲突——可以是后处理 color grading
5. **细微呼吸感**：墙面有非常轻微的 idle 脉动 / 摇摆（anime.js 时间线驱动 shader uniform）
6. **拖拽 + 惯性**：和第一轮 spec 一致
7. **焦点态 + 悬浮播放器**：和第一轮 spec 一致

**不重要 / 可降低优先级**：
- 真实音频播放（mock 即可，重点是视觉）
- 音频驱动光晕（NFR-9，可后期）
- Capacitor Android 性能（可后期，先桌面 Chrome 跑通）

---

## 8. Open Questions（新 AI 接手时要先和用户确认）

1. **NFR-13 包体积**：能否放宽到 `/music` 路由 ≤ 250KB gzipped + 懒加载？
2. **真实音频文件**：`public/audio/track-XX.mp3` 不存在，是放占位音频还是先关掉播放功能？
3. **mock 数据封面**：第一轮用 `https://picsum.photos`，方案 A 走纹理图集，建议改成本地 `public/covers/*.jpg`（避免外网 + 异步加载导致首帧空白）
4. **可访问性**：WebGL 方案 raycaster 接收点击，键盘 Tab 焦点要单独做（FR 默认有键盘可用要求）。是否接受先视觉、a11y 后置？

---

## 9. 文件树期望（方案 A 完成后）

```
app/music/
  page.tsx                          # 路由入口（保留 "use client"）
  layout.tsx                        # 可选，全局 SVG noise / 资源预加载

components/music/
  music-page.tsx                    # 顶层 wrapper（loading / error / canvas）
  music-canvas-r3f.tsx              # <Canvas> + 灯光 + 后处理
  card-wall-mesh.tsx                # 曲面 mesh + 纹理图集 material
  focus-overlay.tsx                 # DOM 焦点态（不在 R3F 内）
  floating-player.tsx               # DOM 悬浮播放器
  shaders/
    card-wall.vert.glsl             # vertex shader（球面投影）
    card-wall.frag.glsl             # fragment shader（图集采样 + vignette）

hooks/music/
  use-music-player.ts               # HTMLAudioElement 单例（同第一轮设计）
  use-tracks.ts                     # repository 数据加载
  use-drag-camera.ts                # PointerEvents → camera offset（取代第一轮 use-drag-inertia）
  use-card-atlas.ts                 # 生成 + 缓存纹理图集
  use-device-tier.ts                # 不变

lib/music/
  types.ts
  mock-tracks.ts
  repository.ts
  local-data-source.ts
  reducer.ts                        # 状态机
  audio-analysis.ts                 # splitBands 不变
  device-tier.ts                    # 不变
  atlas.ts                          # canvas 2D 渲染卡片到 texture
  geometry.ts                       # 鱼眼公式、UV 计算（替代 fisheye.ts/canvas-tiling.ts/masonry.ts）
```

新 AI 看这个文件树心里就有数：纯函数 / 状态层 / hook 层都有继承自第一轮的位置，只是渲染层从 DOM 全部换成 R3F mesh + shader。

---

## 10. 联系上下文

- 第一轮 AI：Claude Opus 4.7
- 第二轮 AI：你
- 用户偏好：直接、有判断力、不追求繁琐确认；时间紧；重视可见的视觉效果而不是抽象的 PBT 覆盖率
- 已确认放弃：CSS 3D transform 路线 + `liquid-glass-react`（peer 不兼容）+ `lenis`（不适合 transform 虚拟画布）
- 已选定：WebGL + R3F + anime.js
