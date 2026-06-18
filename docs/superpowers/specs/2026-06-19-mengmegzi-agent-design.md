# 萌萌子自动发帖/留言/回复 —— 设计文档

**日期**：2026-06-19
**状态**：设计已与用户确认，待写实现计划
**前序**：`2026-06-18-mengmegzi-proactive-dm-design.md`（私信 AI，本项目与之解耦）

---

## 1. 背景与目标

让萌萌子（`MENGMEGZI_USER_ID`）像真实用户一样在论坛活动：

- **发帖**：管理员点一次"发一帖"，她生成一个帖子（含配图）发出。**不轮询**——纯手动单发。
- **留言**：在别人的帖子下评论。可单发（指定帖子）也可轮询（自动扫新帖）。
- **回复**：别人在萌萌子的帖子/评论下评论了她，她去回复。走轮询，与留言共用一个开关。

**核心约束**：
- 那个文本 AI 不支持图片识别 → 配图完全由代码决定，AI 只生成文字。
- Vercel 免费档（function 10s 超时）→ 单发指令走异步（不阻塞等待）。
- 长期运行、成本敏感 → 轮询可随时关，关了几乎零成本。

**不在本次 scope**：
- 点赞/关注等轻交互
- 管理员上传图 + AI 生成文字的发帖模式（未来扩展）
- `image_sources` 的 UI 配置界面（直接改 DB）

---

## 2. 模型与人格

- **模型**：复用 `dm_ai_config` 表（单行表，admin 可热切换）。把萌萌子挂的模型换成那个巨额 token 文本 AI——后台填 `base_url/api_key/model` 即可，10 秒生效，不改代码。
- **人格**：发帖/留言/回复三处 prompt **直接复用 `dm_ai_config.persona` 原文**，不在任务 prompt 里夹带任何性格描述。管理员调人格，三处同步生效。

---

## 3. 架构：CF Worker Cron 驱动（方案 B）

Next.js serverless 无常驻进程，"轮询"靠外部定时器反复戳 tick 端点。

**复用现有 `cloudflare/presence-worker`**（已在跑 `*/5 * * * *`）——给它加一个 cron 表达式 `*/2 * * * *`，专门 fetch `/api/mengmegzi-tick`。

选 B 的理由：复用已跑的基础设施，定时器侧成本趋近于零；唯一不可避免成本是 tick 端点本身的 Vercel function 调用，可通过调大间隔压低。

**成本预算**（免费档）：
- tick：每 2 分钟 1 次 ≈ 21600 次/月
- 面板状态刷新（每天开 2 小时）≈ 21600 次/月
- 合计 ≈ 43200 次/月，占免费档 10 万次/月的 43%，安全

**成本旋钮**：
- 关 `comment_polling_enabled` → 省 AI 调用次数（萌萌子不自动留言，只响应单发）
- 停 CF Worker Cron → 连 tick 的 function 调用都省（萌萌子完全停摆）

---

## 4. 数据表（§1）

三张表，全部 `enable RLS + 无 policy`（仅 service_role 可读写），单行表用 `check (id = 1)` 约束。幂等可重复执行。

### 4.1 `mengmegzi_agent_state`（单行表，状态机）

```sql
create table if not exists public.mengmegzi_agent_state (
  id              int primary key default 1 check (id = 1),
  status          text not null default 'idle',   -- idle=休息中 / busy=行动中 / dead=死机
  current_task    text not null default '',       -- 行动中时描述当前任务
  last_error      text not null default '',       -- 死机时的错误信息
  last_action_at  timestamptz,                    -- 上次成功行动时刻（节奏控制）
  last_error_at   timestamptz,                    -- 上次出错时刻
  busy_since      timestamptz,                    -- 进入 busy 的时刻（超时判定）
  pending_task    jsonb,                          -- 待办任务，null=没有
  updated_at      timestamptz not null default now()
);
alter table public.mengmegzi_agent_state enable row level security;
insert into public.mengmegzi_agent_state (id) values (1) on conflict (id) do nothing;
```

`pending_task` 结构：
```json
{
  "type": "post" | "comment" | "reply",
  "target_post_id": "uuid",    // comment 用
  "target_comment_id": "uuid", // reply 用
  "category": "game",          // post 用（代码随机指定）
  "queued_at": "2026-..."
}
```

### 4.2 `mengmegzi_config`（单行表，行为参数）

```sql
create table if not exists public.mengmegzi_config (
  id                       int primary key default 1 check (id = 1),
  comment_polling_enabled  boolean not null default false,  -- 留言+回复轮询总开关
  comment_interval_min     int not null default 30,         -- 轮询节奏（分钟）
  comment_scan_hours       int not null default 24,         -- 留言只扫最近多少小时新帖
  busy_timeout_min         int not null default 5,          -- busy 超时判死机（分钟）
  image_sources            jsonb not null default '{}',     -- 各分类图源配置
  updated_at               timestamptz not null default now()
);
alter table public.mengmegzi_config enable row level security;
insert into public.mengmegzi_config (id) values (1) on conflict (id) do nothing;
```

默认 `image_sources`（**nsfw 改为 none，不配图**）：
```json
{
  "general": {"provider": "unsplash", "query": "daily life"},
  "nsfw":    {"provider": "none"},
  "game":    {"provider": "unsplash", "query": "video game"},
  "code":    {"provider": "none"},
  "life":    {"provider": "unsplash", "query": "lifestyle"},
  "help":    {"provider": "none"}
}
```

### 4.3 `mengmegzi_action_log`（行动日志）

```sql
create table if not exists public.mengmegzi_action_log (
  id             bigint generated always as identity primary key,
  action_type    text not null,        -- post / comment / reply
  target_id      uuid,                 -- comment: 帖子id; reply: 被回复的评论id; post: null
  result         text not null,        -- success / error
  detail         text not null default '',  -- 成功存生成的 post_id/comment_id；失败存错误
  created_at     timestamptz not null default now()
);
-- 留言查「这个帖有没有成功留言过」用 target_id（action_type=comment 时 target_id 即帖子 id）
create index if not exists idx_mengmegzi_log_target on public.mengmegzi_action_log(action_type, target_id);
-- 留言唯一约束：一个帖萌萌子只留言一次（防刷屏 + 兜底并发）
create unique index if not exists uq_mengmegzi_comment_per_post
  on public.mengmegzi_action_log(target_id)
  where action_type = 'comment' and result = 'success' and target_id is not null;
alter table public.mengmegzi_action_log enable row level security;
```

**字段语义**：`target_id` 按 `action_type` 解释——
- `post`：null（帖子本身在 detail 里）
- `comment`：被留言的帖子 id
- `reply`：被回复的评论 id

---

## 5. API 端点（§2）

5 个端点。前 4 个走 admin 鉴权（复用现有 `requireAdmin`：Bearer token → auth.getUser → 查 admin_users 表），第 5 个走 cron 密钥。

### 5.1 `GET/PATCH /api/admin/mengmegzi-agent/state`（admin）

- `GET` → 返回状态机全字段
- `PATCH` → 改状态（面板"重置"按钮用：`dead → idle`，清 `last_error` 和 `pending_task`）

### 5.2 `GET/PATCH /api/admin/mengmegzi-agent/config`（admin）

- `GET` → 返回配置
- `PATCH` → 改配置

### 5.3 `POST /api/admin/mengmegzi-agent/command`（admin）★

发指令。body 的 `action` 区分：

```ts
// 单发（异步，立刻返回 202 "已受理"）
{ action: "post_now" }                          // 发一帖（分类代码随机指定）
{ action: "comment_now", post_id: "uuid" }      // 给指定帖留言
{ action: "reply_now", comment_id: "uuid" }     // 给指定评论回复

// 轮询开关
{ action: "start_comment_polling" }             // = comment_polling_enabled=true
{ action: "stop_comment_polling" }              // = comment_polling_enabled=false
```

单发流程：
1. 校验 status ≠ dead（死机拒绝，提示先重置）
2. 校验 pending_task 为空（忙时拒绝新单发，提示"当前有任务在执行"）
3. 写 `pending_task`（type/target/category/queued_at），不改 status
4. 立刻返回 202 "已受理"
5. 下一次 tick 执行（最长等 2 分钟）

### 5.4 `GET /api/admin/mengmegzi-agent/log?limit=50`（admin）

返回最近 N 条日志。

### 5.5 `POST /api/mengmegzi-tick`（cron 密钥）★

**不走 admin 鉴权**，校验 header `x-cron-secret` === 环境变量 `MENGMEGZI_CRON_SECRET`。

tick 逻辑：
```
1. 密钥不对 → 401
2. 读 state + config
3. status == 'dead' → return
4. status == 'busy':
   a. now - busy_since > busy_timeout_min → 判死机，转 dead，记 last_error='执行超时(>Xmin)'
   b. 否则 → return（上一次还在跑）
5. status == 'idle':
   a. pending_task 非空 → 执行 pending_task（单发优先），清空 pending_task
   b. pending_task 为空 且 comment_polling_enabled:
      - 距上次行动 < comment_interval_min → return
      - 节奏到了 → 干一件事（回复优先 > 留言）：
        * 先找"待回复的评论"（见 6.3），有就回复
        * 没有就找"可留言的新帖"（见 6.2），有就留言
        * 都没有 → return
   c. 都没有 → return
6. 执行前：status='busy', busy_since=now, current_task=描述
7. 执行后：成功→status='idle', last_action_at=now, 写日志；失败→status='dead', last_error, 写日志
```

---

## 6. 执行内核（§2/§3/§4 合并）

### 6.1 发帖流程（`post_now` / 轮询不触发）

```
1. 代码随机选一个分类（保证 6 类均匀分布）
2. 调文本 AI（§7.1 prompt），输出 JSON {title, content, description, category}
   ⚠ 但分类已由代码指定 → 实际传给 AI 的是"发一个 {category} 分类的帖子"，
     AI 只生成 title/content/description，category 字段忽略 AI 输出
3. 解析 JSON（§8 鲁棒性）
4. 查 image_sources[category]:
   - provider == 'none' → 跳过图，纯文字帖
   - provider == 'unsplash' → 拉图（§6.4）
5. 图片下载 + sharp 压缩 + 上传 Supabase Storage（§6.5）
   任何一步失败 → 降级纯文字帖（不阻断）
6. 组装 post 数据，service_role 写 posts 表：
   {user_id: MENGMEGZI_USER_ID, title, content, description,
    category, image_url, image_urls:[url], image_ratio}
7. 写日志（成功存 post_id）
```

### 6.2 留言目标筛选

```sql
-- 候选帖：最近 scan_hours 内、非萌萌子自己发的、未成功留言过
select p.id, p.title, p.content, p.category
from posts p
where p.created_at > now() - interval '%s hours'
  and p.user_id != '%s'  -- MENGMEGZI_USER_ID
  and not exists (
    select 1 from mengmegzi_action_log l
    where l.target_id = p.id
      and l.action_type = 'comment'
      and l.result = 'success'
  )
order by random()
limit 1
```

拿到帖子 → 调文本 AI（§7.2 prompt）生成评论 → 写 comments 表 → 写日志。

### 6.3 回复目标筛选

"待回复"定义：别人在**萌萌子的帖子**下评论了，或别人**回复了萌萌子的评论**，且萌萌子还没回复过这条。

```sql
-- 候选评论：在萌萌子帖下的、非萌萌子发的、萌萌子没回复过的
select c.id, c.content, c.post_id, p.title, p.content as post_content
from comments c
join posts p on p.id = c.post_id
where p.user_id = '%s'  -- MENGMEGZI_USER_ID（萌萌子的帖）
  and c.user_id != '%s'  -- 非萌萌子
  and not exists (
    select 1 from mengmegzi_action_log l
    where l.target_id = c.id  -- reply 的 target_id 存的是被回复的 comment_id
      and l.action_type = 'reply'
      and l.result = 'success'
  )
order by c.created_at asc
limit 1
```

拿到评论 + 原帖 → 调文本 AI（§7.3 prompt）生成回复 → 写 comments 表（parent_id 指向被回复的评论）→ 写日志。

### 6.4 图源适配层（`lib/mengmegzi/image-sources.ts`）

```ts
export interface ImageResult { url: string; source: string }
export async function fetchImageForCategory(
  category: CategoryValue,
  config: ImageSourceConfig
): Promise<ImageResult | null>
```

Provider：
- `none` → 直接返回 null
- `unsplash` → `GET https://api.unsplash.com/search/photos?query={query}&per_page=1&orientation=squarish`，header `Authorization: Client-ID {UNSPLASH_ACCESS_KEY}`，取 `urls.regular`

返回 null = 不配图或拉图失败，调用方降级纯文字帖。

### 6.5 图片下载 + 压缩（`lib/mengmegzi/image-pipeline.ts`）

```ts
export async function downloadAndCompress(
  imageUrl: string
): Promise<{ blob: Buffer; ext: string; ratio: number } | null>
```

流程：
1. `fetch(imageUrl)` 下载到 Buffer
2. `sharp(buffer).resize(1920, 1920, {fit:'inside'}).webp({quality:0.82}).toBuffer()`
3. `sharp(buffer).metadata()` 拿 width/height 算 ratio = w/h
4. 任何步骤失败 → 返回 null（降级纯文字帖）

参数与客户端 `compressImage` 完全一致（maxEdge 1920 / quality 0.82 / webp）。

### 6.6 上传 Storage

```ts
const path = `mengmegzi/${postId}.webp`
await supabaseAdmin.storage.from('posts').upload(path, blob, {contentType:'image/webp'})
const { data } = supabaseAdmin.storage.from('posts').getPublicUrl(path)
// data.publicUrl 存进 post.image_url / image_urls[0]
```

用 `mengmegzi/` 前缀，方便日后清理（与现有 `cleanup-orphan-post-images.mjs` 思路一致）。

---

## 7. Prompt（§3）

三套 prompt，**人格段统一用 `dm_ai_config.persona` 原文，任务段不含任何性格描述**。严格 JSON 输出。

### 7.1 发帖

**System**：
```
{dm_ai_config.persona}

你现在要像普通用户一样发一个新帖子。

输出严格 JSON，不要任何多余文字：
{"title": "<标题，10~30字>", "content": "<正文，50~300字>", "description": "<一句话摘要，20字内>"}

禁止：代码块包裹、JSON 前后加说明、content 为空。
```

**User**（分类由代码指定，注入给 AI）：
```
发一个 {CATEGORY_LABELS[category]} 分类的帖子。
```

注意：AI 输出不再含 category 字段（分类已由代码决定）。

### 7.2 留言

**System**：
```
{dm_ai_config.persona}

你要在别人的帖子下面留一条评论。

输出严格 JSON：
{"content": "<评论内容，10~80字>"}

禁止：代码块包裹、多余说明、content 为空。
```

**User**：
```
帖子标题：{post.title}
帖子分类：{CATEGORY_LABELS[post.category]}
帖子正文：
{post.content}

请留一条评论：
```

### 7.3 回复

**System**：
```
{dm_ai_config.persona}

有人在你（或你回复过）的内容下评论了，你要回复他。

输出严格 JSON：
{"content": "<回复内容，10~80字>"}

禁止：代码块包裹、多余说明、content 为空。
```

**User**：
```
【原帖标题】{post.title}
【原帖正文】{post.content}

【对方的评论】{comment.content}

请回复他：
```

### 7.4 调用参数

- 发帖：`temperature: 0.9`（多样性）
- 留言/回复：`temperature: 0.7`（贴合语境）
- max_tokens：复用 `MAX_REPLY_TOKENS`（4000，覆盖推理模型思考链）

---

## 8. JSON 解析鲁棒性

LLM 常在 JSON 外裹 ``` 围栏或加前缀。解析逻辑：
1. 去掉首尾 ``` 围栏和 "json" 标记
2. 截取第一个 `{` 到最后一个 `}`
3. `JSON.parse` 失败 → 重试一次（user 消息追加"请只输出 JSON"）
4. 二次失败 → 转 dead，记 `last_error='AI 输出无法解析'`

重试多花一次 AI 调用（额度无限，不在意）。

---

## 9. 状态机（§4-A）

```
        ┌──────────────────────────────────┐
        ▼                                  │
    ┌───────┐  管理员发指令      ┌───────┐  │
    │ idle  │ ──────────────▶   │ busy  │  │
    │ 休息中 │                   │ 行动中 │  │
    └───────┘                   └───┬───┘  │
        ▲                           │      │
        │ 执行成功                   │ 执行失败/超时
        │                           ▼      
        │                       ┌───────┐
        │ 管理员重置              │ dead  │
        └──────────────────────│ 死机  │
                                └───────┘
```

- `busy` 带 `current_task`（描述）和 `busy_since`（超时判定）
- `dead` 带 `last_error`（原因）
- 并发保护纯靠 DB 的 busy 标志（多实例共享），不引入内存限流器（现有 `rate-limit.ts` 的内存计数在 serverless 多实例间不共享，不可靠）

---

## 10. 面板 UI（§5）

在 `app/admin/page.tsx` 加一个新 Tab "萌萌子"，与现有 Tab 平级。复用 shadcn 组件（Card/Switch/Button/Input/Tabs）。

### 10.1 状态卡
- 状态圆点：休息中=灰、行动中=绿（脉动）、死机=红
- 当前任务（busy 时显示 `current_task`）
- 上次行动（相对时间）
- 最近错误（仅死机时显示 `last_error`）
- [重置] 按钮：`dead → idle`，清 `last_error` + `pending_task`
- [刷新] 按钮：手动重拉
- **自动刷新**：面板可见时每 10 秒轮询状态，卸载时 clearInterval

### 10.2 指令卡
- [发一帖] 按钮 → `command {action:"post_now"}`
- 帖子 ID 输入框 + [给该帖留言] → `command {action:"comment_now", post_id}`
- 评论 ID 输入框 + [回复该评论] → `command {action:"reply_now", comment_id}`
- 留言+回复轮询 Switch → 开=`start_comment_polling`，关=`stop_comment_polling`
- 所有指令发完 toast "已受理"，按钮禁用 2 秒防重复
- 死机状态下指令卡按钮置灰，提示"先重置"

### 10.3 配置卡
- 留言节奏（分钟）、扫描小时、busy 超时（分钟）三个数字输入
- [保存配置] → `PATCH /config`
- **`image_sources` 不暴露 UI**（直接改 DB，YAGNI）

### 10.4 日志卡
- 表格：时间 | 类型 | 结果 | 详情
- 默认 50 条，不分页
- [刷新] 按钮

### 10.5 技术细节
- 复用现有 `apiUrl()` + Bearer token fetch 模式
- 状态轮询 `setInterval(10s)`，卸载 `clearInterval`

---

## 11. CF Worker 改动

`cloudflare/presence-worker/wrangler.toml` 加一个 cron：

```toml
[triggers]
crons = ["*/5 * * * *", "*/2 * * * *"]
```

`cloudflare/presence-worker/src/index.ts` 的 `scheduled` handler 里，对 `*/2` 的触发 fetch `${SITE_URL}/api/mengmegzi-tick`，header 带 `x-cron-secret: ${MENGMEGZI_CRON_SECRET}`。

环境变量（wrangler secret）：`MENGMEGZI_CRON_SECRET`、`SITE_URL`。

---

## 12. 环境变量

新增（`.env.local` + Vercel + wrangler secret）：
- `MENGMEGZI_CRON_SECRET` — tick 端点密钥（随机字符串）
- `UNSPLASH_ACCESS_KEY` — Unsplash API key（免费申请）
- `SITE_URL` — 站点 URL（CF Worker 用，如 `https://hanakos.cc`）

复用现有：
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- `DM_AI_*`（已通过 `dm_ai_config` 表覆盖，env 仅作 fallback）

---

## 13. 失败兜底汇总

| 失败点 | 兜底 | 是否死机 |
|---|---|---|
| AI 生成失败 | 转 dead | 是 |
| AI 输出无法解析（二次重试后） | 转 dead | 是 |
| 图片源配置 none | 纯文字帖 | 否 |
| 拉图失败（Unsplash 挂了/网络错） | 纯文字帖 | 否 |
| sharp 压缩失败 | 用原图上传 | 否 |
| 上传 Storage 失败 | 纯文字帖 | 否 |
| busy 超时（>5min） | 转 dead | 是 |
| 写 posts/comments 失败 | 转 dead | 是 |

**核心原则**：图片相关失败不阻断（降级纯文字帖），只有 AI 生成本身或写库失败才死机。

---

## 14. 未来扩展（不在本次 scope）

- **管理员上传图 + AI 生成文字**的发帖模式
- `image_sources` 的 UI 配置界面
- nsfw 配图（用户已明确否决，露点内容不接入）
- 点赞/关注等轻交互
- 发帖分类权重的 UI 调节

---

## 15. 实现顺序建议

1. 数据表 SQL（§4）—— Supabase SQL Editor 执行
2. 环境变量（§12）
3. 图源适配层 + 图片管线（§6.4/6.5/6.6）
4. 执行内核（§6.1/6.2/6.3）+ Prompt（§7）+ JSON 解析（§8）
5. 5 个 API 端点（§5）
6. 面板 UI（§10）
7. CF Worker 改动（§11）
8. 端到端测试：单发发帖 → 单发留言 → 单发回复 → 开轮询 → 关轮询 → 死机恢复
