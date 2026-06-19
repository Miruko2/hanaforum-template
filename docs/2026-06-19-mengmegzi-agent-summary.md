# 萌萌子 Agent —— 今日工作总结

**日期**：2026-06-19
**目标**：让萌萌子（虚拟用户 `MENGMEGZI_USER_ID`）像真实用户一样在论坛自动发帖、留言、回复，管理员可通过面板指令和状态泡控制与观察。

---

## 一、加了什么功能

### 1. 自动发帖（单发指令）
管理员点"发一帖" → 萌萌子生成标题/正文/分类 → 按分类配图 → 写入 posts 表。
- **不轮询**——纯手动单发，点一次发一帖。
- 分类由代码随机指定（保证 6 类均匀），AI 只生成文字内容。
- 图片失败自动降级为纯文字帖，不阻断发帖。

### 2. 自动留言（单发 + 轮询）
- **单发**：管理员在帖子详情页点紫色"萌萌子留言"按钮，给指定帖留言。
- **轮询**：开关开后，每 `comment_interval_min`（默认 30 分钟）自动扫最近 N 小时的新帖，挑一个留言。跳过萌萌子自己的帖、跳过已留过言的帖（数据库唯一约束兜底）。

### 3. 自动回复（单发 + 轮询）
- **单发**：管理员在任意评论/回复行点紫色机器人按钮，让萌萌子回复那条。
- **轮询**：优先级高于留言——如果有人在萌萌子帖下评论了她没回的，先回这个。回复写 comments 表带 `parent_id`。

### 4. 管理员控制台（admin 面板"萌萌子"Tab）
毛玻璃风格四卡片：
- **状态卡**：三态指示（休息中/行动中/死机）+ 当前任务 + 最近错误 + 重置按钮
- **指令卡**：发一帖 / 给指定帖留言 / 回复指定评论 / 轮询开关
- **配置卡**：留言节奏、扫描小时数、busy 超时
- **日志卡**：最近 50 条行动日志

### 5. 全局状态悬浮泡（右下角，仅管理员可见）
- 收起状态：三态圆点 + 文字，轮询开着时紫色边框 + 闪电图标
- 展开卡片：当前任务/错误/上次行动时间 + **轮询开关**（不用进 admin 面板）+ 跳转 admin 链接
- 每 10 秒自动刷新

### 6. 论坛前端管理员按钮
- **帖子详情页**评论区上方：紫色"萌萌子留言"按钮
- **每条评论/回复**操作行：紫色机器人图标按钮（让萌萌子回复这条）
- 仅 `isAdmin` 时渲染，普通用户看不到

---

## 二、怎么实现的

### 架构：CF Worker Cron 驱动 tick

Next.js serverless 无常驻进程，"轮询"靠外部定时器反复戳 tick 端点。复用现有的 `cloudflare/presence-worker`（已在跑 `*/5` 主动私信），加一个 `*/2` cron 专门戳 `/api/mengmegzi-tick`。

```
CF Worker (每2分钟) → POST /api/mengmegzi-tick (带 x-cron-secret)
                            ↓
                      读状态表 + 配置表
                            ↓
                   决定执行什么（见下）
                            ↓
                  更新状态 + 写日志
```

### 数据表（3 张，均 RLS 仅 service_role）

| 表 | 作用 |
|---|---|
| `mengmegzi_agent_state` | 单行状态机：status(idle/busy/dead) / current_task / pending_task / busy_since / last_error |
| `mengmegzi_config` | 单行配置：轮询开关 / 节奏 / 扫描小时 / busy 超时 / image_sources |
| `mengmegzi_action_log` | 行动日志 + 防重复（留言唯一约束：一个帖只留言一次） |

### 状态机与执行流程

**三态**：休息中(idle) / 行动中(busy) / 死机(dead)

**tick 逻辑**：
```
1. 死机 → return
2. busy 且超时(>busy_timeout_min) → 判死机
3. busy 未超时 → return（上次还在跑）
4. idle + 有 pending_task → 执行单发任务（优先）
5. idle + 无 pending + 轮询开 + 节奏到 → 执行轮询任务
   - 优先回复（找待回复评论）→ 没有就留言（找可留言新帖）
```

**单发指令是异步的**：管理员点按钮 → 写 `pending_task` → 立刻返回"已受理" → 下次 tick（≤2分钟）执行。原因：Vercel 免费档 10s 超时，而推理模型生成一帖可能要 30s~2min。

**并发保护**：纯靠 DB 的 busy 标志（多实例共享），不用内存限流器（serverless 多实例间不共享内存）。

### AI 调用

- **模型配置**：复用 `dm_ai_config` 表（admin 后台热切换），把萌萌子挂的模型换成目标文本 AI。10 秒生效，不改代码。
- **人格**：发帖/留言/回复三处 prompt **直接复用 `dm_ai_config.persona` 原文**，任务 prompt 不夹带任何性格描述。
- **JSON 输出**：严格 JSON，解析失败重试一次（追加"请只输出 JSON"），二次失败转死机。
- **超时**：120s（足够推理模型，又不至于卡死 tick）。
- **温度**：发帖 0.9（多样性），留言/回复 0.7（贴合语境）。

### API 端点（5 个）

| 端点 | 鉴权 | 作用 |
|---|---|---|
| `GET/PATCH /api/admin/mengmegzi-agent/state` | admin | 读/改状态（重置用） |
| `GET/PATCH /api/admin/mengmegzi-agent/config` | admin | 读/改配置 |
| `POST /api/admin/mengmegzi-agent/command` | admin | 发指令（单发 + 轮询开关） |
| `GET /api/admin/mengmegzi-agent/log` | admin | 查日志 |
| `POST /api/mengmegzi-tick` | cron secret | CF Worker 每 2 分钟戳 |

---

## 三、萌萌子发帖图片机制（重点 · 2026-06-19 审查后重构）

### 核心矛盾
那个文本 AI 不支持图片识别 → 配图由代码决定，AI 只负责文字 + 顺手吐一个英文配图关键词。

### 分工
| 决策 | 谁做 |
|---|---|
| 帖子标题/正文/分类 | 文本 AI 生成（分类代码随机指定） |
| 配图关键词 `image_query` | 文本 AI 顺手生成（英文，贴合正文） |
| 用哪个图源 | 代码按分类查 `image_sources` 配置 |
| 拉哪张图 | 代码调 Unsplash（AI 关键词优先 → 搜不到回退分类固定词 → top10 随机选一张） |
| 压缩/缩略图/上传 | 代码（Unsplash imgix URL 参数 + Supabase Storage，**不用 sharp**） |

### 图源（image_sources 配置）
- `general`/`game`/`life` → Unsplash 搜真实照片
- `code`/`help`/`nsfw` → `none`（不配图，纯文字帖；nsfw 因露点内容不接入）
- 注：AI 吐的 `image_query` 只对 unsplash 分类生效；none 分类直接纯文字。

### 为什么不用 sharp（关键决策）
Unsplash 图床本身是 imgix——图片 URL 加参数 `&w=&h=&fit=max&fm=webp&q=` 就能直接返回
指定尺寸/格式/质量的图，**下载到的就是压好的 webp**，根本不需要服务端 sharp。这样：
- 彻底绕开 sharp（曾导致 Vercel 构建期 micromatch 爆栈，见坑4；且从 package.json
  移除后运行时 `require("sharp")` 在 Vercel lambda 里大概率拿不到 → 会静默退化成上传未压缩原图）
- 不碰 `package.json` / `next.config`，零构建风险
- 宽高直接从 Unsplash search API 的 `width`/`height` 拿，不必再读图 metadata

### 完整发帖图片流程
```
1. 代码随机选分类（如 life）
2. 调文本 AI 生成 {title, content, description, image_query}
3. 查 image_sources[life] = {provider:"unsplash", query:"lifestyle"}（query 现作回退固定词）
4. fetchImageForCategory(cfg, image_query):
   - 先用 AI 的 image_query 搜（per_page=10、content_filter=high、squarish），随机选一张
   - 搜不到 → 用分类固定词 query 再搜
   - 返回 { rawUrl(imgix 基址), width, height }
5. downloadCompressUpload(img, fileId):   // fileId = crypto.randomUUID()
   - 主图：fetch(rawUrl + &w=1920&h=1920&fit=max&fm=webp&q=82&auto=compress) → 已压好的 webp
   - ratio = height / width（全站约定方向；消费端 post-card-image 按此取倒数渲染）
   - 上传主图：post-images 桶根目录、文件名 mengmegzi-<uuid>.webp、cacheControl 1 年
   - 缩略图：fetch(rawUrl + &w=640&h=640...&q=80) → 上传 mengmegzi-<uuid>_thumb.webp（失败不阻断）
6. 把自己的 publicUrl 存进 posts.image_url / image_urls / image_ratio
   （前端渲染时 cdnUrl() 再重写到 img.hanakos.cc CDN 层）
```

### 与真人发帖对齐的两个关键点（审查后修正）
- **缩略图**：文件名走桶根目录 + `mengmegzi-` 连字符前缀（**不是** `mengmegzi/` 子目录），
  这样 `postThumbUrl` 才认（它拒绝带 `/` 的路径）→ 列表卡片能用 640px 缩略图省 egress。
  原先放子目录 + 不生成缩略图 → feed 卡片直接拉全尺寸主图，抵消了 egress 优化。
- **image_ratio 方向**：存 `height/width`，与 create-post-modal / post-card-image 全站约定一致。
  原先存反了（`width/height`）→ 卡片占位横竖颠倒。

### 失败降级（关键设计）
- Unsplash key 缺失 / 搜图失败 / 空结果 → 跳过配图，纯文字帖
- 主图下载或上传失败 → 纯文字帖
- 缩略图下载/上传失败 → **不阻断**（主图照常，卡片 onError 回退主图）

**核心原则**：图片相关失败永远不阻断发帖（降级纯文字），只有 AI 生成本身或写库失败才死机。

---

## 四、踩过的坑

### 坑 1：tick 一直不执行（轮询器问题）
**现象**：点"发一帖"后面板一直"休息中"，pending_task 写进去了但永远不执行。
**根因**：CF Worker 没部署，本地 dev server 不会自己调 tick。pending_task 写进状态表后，没有任何东西来戳 tick 执行它。
**解决**：本地开了个后台 node 轮询器（每 30s 戳 localhost:3000/api/mengmegzi-tick）代理 cron；上线后靠 CF Worker 的 `*/2` cron。

### 坑 2：Storage bucket not found
**现象**：发帖成功但没图，debug 端点报 `Bucket not found`。
**根因**：`constants.ts` 里写死 `POSTS_BUCKET = "posts"`，但实际桶名是 `post-images`。
**解决**：改成 `post-images`。教训：不要假设桶名，先 `listBuckets()` 确认。

### 坑 3：UNSPLASH_ACCESS_KEY 不生效
**现象**：重启 dev server 后发帖还是没图。
**根因**：`.env.local` 改了但 dev server 没重启，运行中的进程读到的是旧环境变量（空 key）。
**解决**：彻底重启 dev server。Next.js 不热重载环境变量。

### 坑 4：Vercel 构建失败 —— micromatch 栈溢出（最大坑）
**现象**：本地 `next build` 成功，Vercel 上同样命令报 `RangeError: Maximum call stack size exceeded` 在 `micromatch` 的 `picomatch.makeRe` → `create` 递归。
**定位过程**：
1. revert 全部代码 → Vercel 构建成功 → 确认是本次代码引起
2. 禁用 `optimizePackageImports` → 还是失败 → 排除
3. 看 Vercel 完整日志：错误在 **`Collecting build traces ...`** 阶段（file tracing）
4. file tracing 用 micromatch 扫依赖树，新增的 **sharp 原生模块**在 Linux node_modules 里的依赖树（libvips 等深层依赖）让 glob 递归爆栈
**根因**：sharp 作为显式依赖，其原生模块依赖树在 Vercel(Linux) 构建环境的 file tracing 阶段触发 micromatch 递归。本地 Windows 的 node_modules 结构不同所以能过。
**解决**：从 `package.json` 移除 sharp 依赖，`image-pipeline.ts` 改运行时 `require("sharp")`。Vercel 运行时由 Next.js 自带 sharp（图片优化用），构建时不再扫 sharp 依赖树。
**降级**：运行时拿不到 sharp 则用原图上传（不压缩），功能不中断。
**后续（2026-06-19 审查）**：上面"移除依赖 + 运行时 require"只解决了构建爆栈——但运行时 require 在 Vercel lambda 里大概率拿不到，会**静默退化成上传未压缩原图**（还把 ratio 退成 1）。最终**彻底去掉 sharp**，改用 Unsplash imgix URL 参数下载即压好的 webp（见第三节），从根上消除对 sharp 的依赖，本地与生产链路一致。

### 坑 5：戳错域名
**现象**：测生产 tick 端点一直 404，所有 `/api/*` 全 404。
**根因**：论坛在 `forum.hanakos.cc`，我一直戳 `hanakos.cc`（根域，是另一个东西）。
**解决**：改用 `forum.hanakos.cc`。CF Worker 的 `wrangler.toml` 里 `MENGMEGZI_TICK_URL` 也从 `hanakos.cc` 改成 `forum.hanakos.cc`，重新部署 worker。

### 坑 6：评论回复按钮"看不到"
**现象**：用户说回复行上看不到萌萌子回复按钮。
**真相**：用户后来发现是自己没看仔细，按钮在。虚惊一场，代码是对的（`isAdmin` prop 链路完整：CommentList → CommentItem/ReplyRow）。

---

## 五、文件清单

### 新增（lib + api + 组件 + 文档）
```
lib/mengmegzi/
  constants.ts          常量（USER_ID/分类/温度/压缩参数/桶名 + 文件名前缀）
  image-sources.ts      图源适配层（none/unsplash；AI 关键词优先 + 回退 + top10 随机）
  image-pipeline.ts     下载 + 缩略图 + 上传管线（Unsplash imgix 参数，不用 sharp）
  prompts.ts            3 套 prompt 构建（复用 persona；发帖含 image_query）
  ai-client.ts          AI 调用 + JSON 鲁棒解析
  state.ts              状态机读写 + pending_task + 日志
  executor.ts           执行内核（发帖/留言/回复 + 目标筛选，轮询查询有界）
  __tests__/            image-sources + ai-client 测试（18 个）

app/api/admin/mengmegzi-agent/
  state/route.ts        状态读写
  config/route.ts       配置读写
  command/route.ts      指令（单发 + 轮询开关）
  log/route.ts          日志查询
app/api/mengmegzi-tick/route.ts   cron tick 端点

components/admin/mengmegzi-agent-panel.tsx   admin 面板（毛玻璃）
components/mengmegzi-status-bubble.tsx       右下角状态泡
hooks/use-mengmegzi-command.ts               指令发送 hook

scripts/2026-06-19-mengmegzi-agent.sql       3 张表 DDL
docs/superpowers/specs/2026-06-19-mengmegzi-agent-design.md   设计文档
docs/superpowers/plans/2026-06-19-mengmegzi-agent.md          实现计划
```

### 修改
```
app/admin/page.tsx                    加"萌萌子"Tab
components/providers.tsx              挂载状态泡
components/comment/comment-item.tsx   评论/回复加管理员"萌萌子回复"按钮
components/post-detail-modal.tsx      帖子详情加"萌萌子留言"按钮
cloudflare/presence-worker/wrangler.toml  加 */2 cron + TICK_URL
cloudflare/presence-worker/src/index.ts   scheduled handler 分流 + tickMengmegzi()
.env.local                            MENGMEGZI_CRON_SECRET / UNSPLASH_ACCESS_KEY / SITE_URL
```

### 环境变量（Vercel + .env.local）
```
MENGMEGZI_CRON_SECRET=484746a33e2bad5c90176704a56a9fe8   (tick 鉴权，与 wrangler secret 一致)
UNSPLASH_ACCESS_KEY=<你的 Unsplash key>                  (发帖配图)
SITE_URL=http://localhost:3000                           (本地，生产用 forum.hanakos.cc)
```

---

## 六、成本与运维

### Vercel function 配额（免费档 10 万次/月）
- tick：每 2 分钟 1 次 ≈ 21600/月
- 面板/状态泡刷新：每天开 2 小时 ≈ 21600/月
- 合计 ≈ 43%，安全

### 成本旋钮
- **关轮询开关** → 省 AI 调用次数（萌萌子不自动行动，只响应单发）
- **停 CF Worker Cron** → 连 tick 的 function 调用都省（萌萌子完全停摆）

### 死机恢复
- AI 调用失败 / 写库失败 / busy 超时 → 转 dead
- dead 状态下：tick 不执行、单发指令被拒（按钮置灰）、轮询停止
- 管理员点"重置" → dead 清空回 idle，一切恢复

---

## 七、未来可扩展（未实现）

- 管理员上传图 + AI 生成文字的发帖模式（注意：用户上传的图不来自 Unsplash imgix，届时
  需重新引入服务端压缩——sharp 走 `next.config` 的 `serverExternalPackages` 排除文件追踪以避开坑4，或换别的压缩方案）
- `image_sources` 的 UI 配置界面（目前直接改 DB）
- nsfw 配图（已明确否决，露点内容不接入）
- 发帖分类权重的 UI 调节
- 帖子详情独立路由（`/post/[id]`），让状态泡任务文案可点击跳转

---

## 八、关键提交记录

```
9c75325 fix(mengmegzi): correct tick URL to forum.hanakos.cc in wrangler.toml
f8db12b fix(build): use runtime require for sharp to avoid micromatch stack overflow on Vercel
...（中间有 revert/revert revert 的调试提交）
6e41024 docs(mengmegzi): add agent design spec and implementation plan
```

设计文档：`docs/superpowers/specs/2026-06-19-mengmegzi-agent-design.md`
实现计划：`docs/superpowers/plans/2026-06-19-mengmegzi-agent.md`

---

## 九、审查后修复（2026-06-19 同日）

代码审查发现几处真 bug 与 egress 隐患，已修复（7 个文件，未动数据库）：

| # | 问题 | 修复 |
|---|---|---|
| 1 | 🔴 tick 端点无 `maxDuration`，AI 调用 >10s 会被 Vercel 杀 → 卡 busy → 判死机 | `mengmegzi-tick/route.ts` 加 `export const maxDuration = 60`（Hobby 上限；推理模型 >60s 需上 Pro 调 300 或移到 CF Worker） |
| 2 | 🔴 `image_ratio` 存反了（`width/height`，全站约定是 `height/width`） | pipeline 改 `height/width`，且直接用 Unsplash API 宽高 |
| 3 | 🟠 sharp 运行时在 Vercel lambda 拿不到 → 静默不压缩 | 彻底去 sharp，改 Unsplash imgix 参数下载即压好的 webp |
| 4 | 🟠 `mengmegzi/` 子目录破坏缩略图约定 + 不生成缩略图 → feed 拉全尺寸主图 | 改桶根目录 + `mengmegzi-` 前缀文件名；同步生成 `_thumb.webp` |
| 5 | 🟠 上传缺 `cacheControl`（默认 1h）→ 多回源 egress | 主图 + 缩略图都加 `cacheControl: "31536000"`（1 年） |
| 6 | 🟡 配图"每类永远同一张"（`per_page=1` + 固定词） | AI 出 `image_query` 关键词按正文搜图 + `per_page=10` 随机选 + `content_filter=high` |
| 7 | 🟡 轮询查询随历史无界增长 | `findCommentablePost`/`findReplyableComment` 改成先查候选、再用候选 id 反查日志，两边有界 |

**验证**：18 个单元测试全过；`tsc --noEmit` 无相关类型错误；未新增环境变量、未改数据库。

**待运维确认**：生产实发一帖看 Storage 是否有 `mengmegzi-<id>.webp` + `_thumb.webp` 两个 webp 文件、`image_ratio` 是否合理、连发是否图不重样；`maxDuration=60` 是否够（取决于计划与模型速度）。

**已知未做**（保持与现有 hanako 一致）：内容不过 `moderate-text` 审核；Unsplash 未做署名/download 端点（严格合规可后续补）。
