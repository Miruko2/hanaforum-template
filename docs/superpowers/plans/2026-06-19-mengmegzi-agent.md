# 萌萌子 Agent（自动发帖/留言/回复）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让萌萌子（`MENGMEGZI_USER_ID`）像真实用户一样在论坛发帖、留言、回复，由 CF Worker Cron 驱动 tick 端点执行，管理员通过面板指令控制和观察状态。

**Architecture:** 单行状态表 `mengmegzi_agent_state`（idle/busy/dead 三态 + pending_task）+ 配置表 `mengmegzi_config` + 日志表 `mengmegzi_action_log`。CF Worker 每 2 分钟戳 `/api/mengmegzi-tick`，tick 读状态决定执行单发任务或轮询留言/回复。图片由代码按分类从 Unsplash 拉、sharp 压缩、上传 Supabase Storage，文本 AI 只生成文字。

**Tech Stack:** Next.js 14 Route Handlers（server-only）、Supabase（service_role）、sharp（服务端图像压缩）、Cloudflare Worker Cron、Unsplash API。

**Spec:** `docs/superpowers/specs/2026-06-19-mengmegzi-agent-design.md`

---

## 文件结构

### 新建文件

| 文件 | 责任 |
|---|---|
| `scripts/2026-06-19-mengmegzi-agent.sql` | 3 张表的 DDL（幂等） |
| `lib/mengmegzi/constants.ts` | 常量：MENGMEGZI_USER_ID、分类列表、节奏默认值、温度、max_tokens |
| `lib/mengmegzi/image-sources.ts` | 图源适配层（none/unsplash） |
| `lib/mengmegzi/image-pipeline.ts` | 图片下载 + sharp 压缩 + 上传 Storage |
| `lib/mengmegzi/prompts.ts` | 3 套 prompt 构建（发帖/留言/回复） |
| `lib/mengmegzi/ai-client.ts` | 调文本 AI + JSON 解析鲁棒性 |
| `lib/mengmegzi/executor.ts` | 执行内核：发帖/留言/回复三个函数 |
| `lib/mengmegzi/state.ts` | 状态机读写 + pending_task 管理 |
| `app/api/admin/mengmegzi-agent/state/route.ts` | 状态读写端点 |
| `app/api/admin/mengmegzi-agent/config/route.ts` | 配置读写端点 |
| `app/api/admin/mengmegzi-agent/command/route.ts` | 指令端点 |
| `app/api/admin/mengmegzi-agent/log/route.ts` | 日志端点 |
| `app/api/mengmegzi-tick/route.ts` | cron tick 端点 |
| `components/admin/mengmegzi-agent-panel.tsx` | 面板 UI 组件 |
| `lib/mengmegzi/__tests__/ai-client.test.ts` | JSON 解析测试 |
| `lib/mengmegzi/__tests__/image-sources.test.ts` | 图源测试 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `cloudflare/presence-worker/wrangler.toml` | 加 `*/2 * * * *` cron |
| `cloudflare/presence-worker/src/index.ts` | scheduled handler 分流：`*/5` 走 proactive，`*/2` 走 mengmegzi tick |
| `app/admin/page.tsx` | 加 "萌萌子" Tab，挂载 agent panel |
| `.env.local` | 加 MENGMEGZI_CRON_SECRET / UNSPLASH_ACCESS_KEY / SITE_URL |

---

## Task 1: 数据表 SQL

**Files:**
- Create: `scripts/2026-06-19-mengmegzi-agent.sql`

- [ ] **Step 1: 写 SQL 文件**

```sql
-- ============================================================
-- 萌萌子 Agent：状态机 + 配置 + 行动日志
-- 在 Supabase → SQL Editor 整段执行（幂等，可重复跑）
-- 全部 enable RLS 无 policy → 仅 service_role 可读写
-- ============================================================

-- ① 状态机（单行表）
create table if not exists public.mengmegzi_agent_state (
  id              int primary key default 1 check (id = 1),
  status          text not null default 'idle',   -- idle=休息中 / busy=行动中 / dead=死机
  current_task    text not null default '',       -- 行动中时描述当前任务
  last_error      text not null default '',       -- 死机时的错误信息
  last_action_at  timestamptz,                    -- 上次成功行动时刻
  last_error_at   timestamptz,                    -- 上次出错时刻
  busy_since      timestamptz,                    -- 进入 busy 的时刻（超时判定）
  pending_task    jsonb,                          -- 待办任务，null=没有
  updated_at      timestamptz not null default now()
);
alter table public.mengmegzi_agent_state enable row level security;
insert into public.mengmegzi_agent_state (id) values (1) on conflict (id) do nothing;

-- ② 配置（单行表）
create table if not exists public.mengmegzi_config (
  id                       int primary key default 1 check (id = 1),
  comment_polling_enabled  boolean not null default false,
  comment_interval_min     int not null default 30,
  comment_scan_hours       int not null default 24,
  busy_timeout_min         int not null default 5,
  image_sources            jsonb not null default '{}'::jsonb,
  updated_at               timestamptz not null default now()
);
alter table public.mengmegzi_config enable row level security;
insert into public.mengmegzi_config (id, image_sources) values (1, '{
  "general": {"provider": "unsplash", "query": "daily life"},
  "nsfw":    {"provider": "none"},
  "game":    {"provider": "unsplash", "query": "video game"},
  "code":    {"provider": "none"},
  "life":    {"provider": "unsplash", "query": "lifestyle"},
  "help":    {"provider": "none"}
}'::jsonb) on conflict (id) do nothing;

-- ③ 行动日志
create table if not exists public.mengmegzi_action_log (
  id             bigint generated always as identity primary key,
  action_type    text not null,        -- post / comment / reply
  target_id      uuid,                 -- comment:帖子id; reply:被回复评论id; post:null
  result         text not null,        -- success / error
  detail         text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists idx_mengmegzi_log_target on public.mengmegzi_action_log(action_type, target_id);
create unique index if not exists uq_mengmegzi_comment_per_post
  on public.mengmegzi_action_log(target_id)
  where action_type = 'comment' and result = 'success' and target_id is not null;
alter table public.mengmegzi_action_log enable row level security;

comment on table public.mengmegzi_agent_state is '萌萌子 Agent 状态机(idle/busy/dead);仅 service_role';
comment on table public.mengmegzi_config is '萌萌子 Agent 行为参数;仅 service_role';
comment on table public.mengmegzi_action_log is '萌萌子 Agent 行动日志+防重复;仅 service_role';
```

- [ ] **Step 2: 在 Supabase SQL Editor 执行**

打开 Supabase Dashboard → SQL Editor → 粘贴 `scripts/2026-06-19-mengmegzi-agent.sql` 全文 → Run。

- [ ] **Step 3: 验证表创建**

在 SQL Editor 跑：
```sql
select 'state' as t, count(*) from mengmegzi_agent_state
union all select 'config', count(*) from mengmegzi_config
union all select 'log', count(*) from mengmegzi_action_log;
```
Expected: 三行，前两行 count=1，第三行 count=0。

- [ ] **Step 4: Commit**

```bash
git add scripts/2026-06-19-mengmegzi-agent.sql
git commit -m "feat(mengmegzi): add agent state/config/log tables"
```

---

## Task 2: 环境变量 + 常量

**Files:**
- Modify: `.env.local`
- Create: `lib/mengmegzi/constants.ts`

- [ ] **Step 1: 加环境变量到 .env.local**

在 `.env.local` 末尾追加：
```
# 萌萌子 Agent
MENGMEGZI_CRON_SECRET=<随机字符串，用 openssl rand -hex 16 生成>
UNSPLASH_ACCESS_KEY=<去 https://unsplash.com/oauth/applications 申请>
SITE_URL=http://localhost:3000
```

生成密钥：
```bash
openssl rand -hex 16
```

- [ ] **Step 2: 写常量文件**

```typescript
// lib/mengmegzi/constants.ts

/** 萌萌子的固定用户 ID（与 lib/hanako/constants.ts 的 MENGMEGZI_USER_ID 一致） */
export const MENGMEGZI_USER_ID = "78257113-e5da-4bcb-bb7a-9b1824439cd1"

/** 所有合法分类（与 lib/categories.ts 的 CATEGORIES 对齐） */
export const ALL_CATEGORIES = ["general", "nsfw", "game", "code", "life", "help"] as const
export type AgentCategory = (typeof ALL_CATEGORIES)[number]

/** 发帖温度（多样性） */
export const POST_TEMPERATURE = 0.9
/** 留言/回复温度（贴合语境） */
export const COMMENT_TEMPERATURE = 0.7

/** max_tokens（复用 hanako 的 MAX_REPLY_TOKENS，覆盖推理模型思考链） */
export const MAX_AGENT_TOKENS = 4000

/** 图片压缩参数（与客户端 lib/image-compress.ts 一致） */
export const IMAGE_MAX_EDGE = 1920
export const IMAGE_QUALITY = 82

/** Storage 桶名 + 路径前缀 */
export const POSTS_BUCKET = "posts"
export const MENGMEGZI_STORAGE_PREFIX = "mengmegzi"

/** 默认 image_sources（与表里的初始值一致，代码里用于校验/回退） */
export const DEFAULT_IMAGE_SOURCES = {
  general: { provider: "unsplash", query: "daily life" },
  nsfw: { provider: "none" },
  game: { provider: "unsplash", query: "video game" },
  code: { provider: "none" },
  life: { provider: "unsplash", query: "lifestyle" },
  help: { provider: "none" },
} as const
```

- [ ] **Step 3: Commit**

```bash
git add .env.local lib/mengmegzi/constants.ts
git commit -m "feat(mengmegzi): add env vars and constants"
```

---

## Task 3: 图源适配层（TDD）

**Files:**
- Create: `lib/mengmegzi/image-sources.ts`
- Create: `lib/mengmegzi/__tests__/image-sources.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// lib/mengmegzi/__tests__/image-sources.test.ts
import { fetchImageForCategory, type ImageSourceConfig } from "../image-sources"

// mock global fetch
const fetchMock = jest.fn() as jest.Mock
global.fetch = fetchMock as any

describe("image-sources", () => {
  beforeEach(() => fetchMock.mockReset())

  test("provider=none 返回 null", async () => {
    const cfg: ImageSourceConfig = { provider: "none" }
    const r = await fetchImageForCategory("code" as any, cfg)
    expect(r).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("provider=unsplash 返回 url", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ urls: { regular: "https://images.unsplash.com/photo-1" } }],
      }),
    } as any)
    const cfg: ImageSourceConfig = { provider: "unsplash", query: "video game" }
    const r = await fetchImageForCategory("game" as any, cfg)
    expect(r).not.toBeNull()
    expect(r!.url).toBe("https://images.unsplash.com/photo-1")
    expect(r!.source).toBe("unsplash")
    // 确认调了 unsplash API 且带 key
    const calledUrl = new URL(fetchMock.mock.calls[0][0])
    expect(calledUrl.hostname).toBe("api.unsplash.com")
    expect(calledUrl.searchParams.get("query")).toBe("video game")
  })

  test("unsplash 失败返回 null（调用方降级纯文字）", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "err" } as any)
    const cfg: ImageSourceConfig = { provider: "unsplash", query: "x" }
    const r = await fetchImageForCategory("life" as any, cfg)
    expect(r).toBeNull()
  })

  test("未知 provider 返回 null", async () => {
    const cfg: ImageSourceConfig = { provider: "foobar" as any }
    const r = await fetchImageForCategory("general" as any, cfg)
    expect(r).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest lib/mengmegzi/__tests__/image-sources.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

```typescript
// lib/mengmegzi/image-sources.ts
//
// 图源适配层：按分类配置拉一张外部图。
// AI 不碰图——选哪个源、拉哪张图全由代码决定。
// 返回 null = 不配图或拉图失败，调用方降级纯文字帖。

export type CategoryValue = string

export interface ImageSourceConfig {
  provider: "none" | "unsplash"
  query?: string
}

export interface ImageResult {
  url: string
  source: string
}

/**
 * 按分类配置拉一张图。
 * - provider=none → 直接返回 null（纯文字帖）
 * - provider=unsplash → 调 Unsplash search API
 * - 任何失败 → 返回 null（调用方降级）
 */
export async function fetchImageForCategory(
  _category: CategoryValue,
  config: ImageSourceConfig,
): Promise<ImageResult | null> {
  if (!config || config.provider === "none") return null
  if (config.provider === "unsplash") return await fetchFromUnsplash(config.query || "")
  return null
}

async function fetchFromUnsplash(query: string): Promise<ImageResult | null> {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) {
    console.warn("[mengmegzi] UNSPLASH_ACCESS_KEY 未配置，跳过配图")
    return null
  }
  const url = new URL("https://api.unsplash.com/search/photos")
  url.searchParams.set("query", query)
  url.searchParams.set("per_page", "1")
  url.searchParams.set("orientation", "squarish")
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Client-ID ${key}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.warn("[mengmegzi] unsplash 失败:", res.status)
      return null
    }
    const data = (await res.json()) as { results?: { urls?: { regular?: string } }[] }
    const u = data.results?.[0]?.urls?.regular
    return u ? { url: u, source: "unsplash" } : null
  } catch (e: any) {
    console.warn("[mengmegzi] unsplash 异常:", e?.message || e)
    return null
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest lib/mengmegzi/__tests__/image-sources.test.ts
```
Expected: PASS（4 tests）。

- [ ] **Step 5: Commit**

```bash
git add lib/mengmegzi/image-sources.ts lib/mengmegzi/__tests__/image-sources.test.ts
git commit -m "feat(mengmegzi): image source adapter (none/unsplash)"
```

---

## Task 4: 图片下载 + 压缩 + 上传管线

**Files:**
- Create: `lib/mengmegzi/image-pipeline.ts`

- [ ] **Step 1: 安装 sharp**

```bash
npm install sharp
npm install --save-dev @types/sharp
```

注意：Vercel serverless 原生支持 sharp。若 `npm install` 报 peer 冲突，用 `npm install sharp --legacy-peer-deps`。

- [ ] **Step 2: 写实现**

```typescript
// lib/mengmegzi/image-pipeline.ts
//
// 服务端图片处理：外部 URL → 下载 → sharp 压缩 → 上传 Supabase Storage。
// 复用客户端 lib/image-compress.ts 的参数（maxEdge 1920 / quality 82 / webp）。
// 任何步骤失败返回 null，调用方降级纯文字帖。

import sharp from "sharp"
import { createClient } from "@supabase/supabase-js"
import { IMAGE_MAX_EDGE, IMAGE_QUALITY, POSTS_BUCKET, MENGMEGZI_STORAGE_PREFIX } from "./constants"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export interface ProcessedImage {
  publicUrl: string
  ratio: number
}

/**
 * 下载外部图 + sharp 压缩 + 上传 Storage，返回自己的 CDN URL + 宽高比。
 * 任何步骤失败返回 null。
 */
export async function downloadCompressUpload(
  imageUrl: string,
  postId: string,
): Promise<ProcessedImage | null> {
  try {
    // 1. 下载
    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      console.warn("[mengmegzi] 图片下载失败:", res.status)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())

    // 2. 读原始宽高算 ratio
    const meta = await sharp(buf).metadata()
    const ratio = meta.width && meta.height ? meta.width / meta.height : 1

    // 3. 压缩（resize + webp）
    const compressed = await sharp(buf)
      .resize(IMAGE_MAX_EDGE, IMAGE_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: IMAGE_QUALITY })
      .toBuffer()

    // 4. 上传 Storage
    const path = `${MENGMEGZI_STORAGE_PREFIX}/${postId}.webp`
    const { error: upErr } = await supabaseAdmin.storage
      .from(POSTS_BUCKET)
      .upload(path, compressed, { contentType: "image/webp", upsert: true })
    if (upErr) {
      console.warn("[mengmegzi] Storage 上传失败:", upErr.message)
      return null
    }

    const { data } = supabaseAdmin.storage.from(POSTS_BUCKET).getPublicUrl(path)
    return { publicUrl: data.publicUrl, ratio }
  } catch (e: any) {
    console.warn("[mengmegzi] 图片管线异常:", e?.message || e)
    return null
  }
}
```

- [ ] **Step 3: 验证类型编译**

```bash
npx tsc --noEmit lib/mengmegzi/image-pipeline.ts lib/mengmegzi/constants.ts
```
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json lib/mengmegzi/image-pipeline.ts
git commit -m "feat(mengmegzi): image download+compress+upload pipeline (sharp)"
```

---

## Task 5: Prompt 构建

**Files:**
- Create: `lib/mengmegzi/prompts.ts`

- [ ] **Step 1: 写实现**

```typescript
// lib/mengmegzi/prompts.ts
//
// 3 套 prompt：发帖/留言/回复。
// 人格段统一用 dm_ai_config.persona 原文，任务段不含任何性格描述。
// 严格 JSON 输出。

import { CATEGORY_LABELS } from "@/lib/categories"
import type { CategoryValue } from "@/lib/categories"
import type { Comment } from "@/lib/types"

export interface TargetPost {
  id: string
  title: string
  content: string
  category: string
}

/** 发帖 system prompt（分类由代码指定，注入 user 消息） */
export function buildPostSystemPrompt(persona: string): string {
  return `${persona}

你现在要像普通用户一样发一个新帖子。

输出严格 JSON，不要任何多余文字：
{"title": "<标题，10~30字>", "content": "<正文，50~300字>", "description": "<一句话摘要，20字内>"}

禁止：代码块包裹、JSON 前后加说明、content 为空。`
}

/** 发帖 user 消息（注入代码随机指定的分类） */
export function buildPostUserMessage(category: CategoryValue): string {
  return `发一个 ${CATEGORY_LABELS[category] || category} 分类的帖子。`
}

/** 留言 system prompt */
export function buildCommentSystemPrompt(persona: string): string {
  return `${persona}

你要在别人的帖子下面留一条评论。

输出严格 JSON：
{"content": "<评论内容，10~80字>"}

禁止：代码块包裹、多余说明、content 为空。`
}

/** 留言 user 消息（注入目标帖子） */
export function buildCommentUserMessage(post: TargetPost): string {
  return `帖子标题：${post.title}
帖子分类：${CATEGORY_LABELS[post.category] || post.category}
帖子正文：
${post.content}

请留一条评论：`
}

/** 回复 system prompt */
export function buildReplySystemPrompt(persona: string): string {
  return `${persona}

有人在你（或你回复过）的内容下评论了，你要回复他。

输出严格 JSON：
{"content": "<回复内容，10~80字>"}

禁止：代码块包裹、多余说明、content 为空。`
}

/** 回复 user 消息（注入原帖 + 对方评论） */
export function buildReplyUserMessage(post: TargetPost, comment: { content: string }): string {
  return `【原帖标题】${post.title}
【原帖正文】${post.content}

【对方的评论】${comment.content}

请回复他：`
}
```

- [ ] **Step 2: 验证类型编译**

```bash
npx tsc --noEmit lib/mengmegzi/prompts.ts
```
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add lib/mengmegzi/prompts.ts
git commit -m "feat(mengmegzi): prompt builders for post/comment/reply"
```

---

## Task 6: AI Client + JSON 解析（TDD）

**Files:**
- Create: `lib/mengmegzi/ai-client.ts`
- Create: `lib/mengmegzi/__tests__/ai-client.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// lib/mengmegzi/__tests__/ai-client.test.ts
import { parseJsonFromLlm } from "../ai-client"

describe("parseJsonFromLlm", () => {
  test("纯 JSON 直接解析", () => {
    expect(parseJsonFromLlm('{"title":"hi","content":"x","description":"d"}')).toEqual({
      title: "hi",
      content: "x",
      description: "d",
    })
  })

  test("去掉 ```json 围栏", () => {
    const raw = '```json\n{"title":"hi","content":"x","description":"d"}\n```'
    expect(parseJsonFromLlm(raw)).toEqual({ title: "hi", content: "x", description: "d" })
  })

  test("去掉 ``` 围栏（无 json 标记）", () => {
    const raw = '```\n{"title":"hi","content":"x","description":"d"}\n```'
    expect(parseJsonFromLlm(raw)).toEqual({ title: "hi", content: "x", description: "d" })
  })

  test("去掉前缀说明文字", () => {
    const raw = '好的：\n{"title":"hi","content":"x","description":"d"}'
    expect(parseJsonFromLlm(raw)).toEqual({ title: "hi", content: "x", description: "d" })
  })

  test("去掉后缀说明文字", () => {
    const raw = '{"title":"hi","content":"x","description":"d"}\n以上是回复。'
    expect(parseJsonFromLlm(raw)).toEqual({ title: "hi", content: "x", description: "d" })
  })

  test("非法 JSON 返回 null", () => {
    expect(parseJsonFromLlm("这不是JSON")).toBeNull()
    expect(parseJsonFromLlm("")).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest lib/mengmegzi/__tests__/ai-client.test.ts
```
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

```typescript
// lib/mengmegzi/ai-client.ts
//
// 调文本 AI（OpenAI 兼容 /chat/completions）+ JSON 鲁棒解析。
// 复用 dm_ai_config 的 base_url/api_key/model/persona。

export interface DmAiCfg {
  baseUrl: string
  apiKey: string
  model: string
  persona: string
}

export interface ChatMessage {
  role: "system" | "user"
  content: string
}

/**
 * 鲁棒解析 LLM 输出里的 JSON：去围栏、截首尾花括号、parse。
 * 失败返回 null（调用方决定重试或死机）。
 */
export function parseJsonFromLlm(raw: string): any | null {
  if (!raw || typeof raw !== "string") return null
  let s = raw.trim()
  // 去 ``` 围栏
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
  // 截第一个 { 到最后一个 }
  const first = s.indexOf("{")
  const last = s.lastIndexOf("}")
  if (first === -1 || last === -1 || last <= first) return null
  s = s.slice(first, last + 1)
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/**
 * 调一次 AI。失败抛错（调用方 catch 后决定死机/降级）。
 */
export async function callAi(
  cfg: DmAiCfg,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(250000), // ~4 分钟，留 busy_timeout(5min) 余量
  })
  if (!res.ok) {
    throw new Error(`AI 调用失败 ${res.status}: ${await res.text()}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || ""
}

/**
 * 调 AI 并解析 JSON，失败重试一次（user 消息追加"请只输出 JSON"）。
 * 二次失败抛错。
 */
export async function callAiForJson(
  cfg: DmAiCfg,
  messages: ChatMessage[],
  temperature: number,
  maxTokens: number,
): Promise<any> {
  const raw1 = await callAi(cfg, messages, temperature, maxTokens)
  const parsed1 = parseJsonFromLlm(raw1)
  if (parsed1) return parsed1

  // 重试：追加约束
  const retryMessages: ChatMessage[] = [
    ...messages,
    { role: "user", content: "请只输出 JSON，不要任何其他文字。" },
  ]
  const raw2 = await callAi(cfg, retryMessages, temperature, maxTokens)
  const parsed2 = parseJsonFromLlm(raw2)
  if (parsed2) return parsed2

  throw new Error("AI 输出无法解析为 JSON（二次重试后仍失败）")
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest lib/mengmegzi/__tests__/ai-client.test.ts
```
Expected: PASS（6 tests）。

- [ ] **Step 5: Commit**

```bash
git add lib/mengmegzi/ai-client.ts lib/mengmegzi/__tests__/ai-client.test.ts
git commit -m "feat(mengmegzi): AI client with robust JSON parsing"
```

---

## Task 7: 状态机读写

**Files:**
- Create: `lib/mengmegzi/state.ts`

- [ ] **Step 1: 写实现**

```typescript
// lib/mengmegzi/state.ts
//
// 状态机读写 + pending_task 管理。
// 纯靠 DB busy 标志做并发保护（serverless 多实例共享），不用内存限流器。

import { createClient } from "@supabase/supabase-js"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export type AgentStatus = "idle" | "busy" | "dead"

export interface PendingTask {
  type: "post" | "comment" | "reply"
  target_post_id?: string
  target_comment_id?: string
  category?: string
  queued_at: string
}

export interface AgentState {
  status: AgentStatus
  current_task: string
  last_error: string
  last_action_at: string | null
  last_error_at: string | null
  busy_since: string | null
  pending_task: PendingTask | null
}

export interface AgentConfig {
  comment_polling_enabled: boolean
  comment_interval_min: number
  comment_scan_hours: number
  busy_timeout_min: number
  image_sources: Record<string, any>
}

export async function loadState(): Promise<AgentState | null> {
  const { data } = await supabaseAdmin
    .from("mengmegzi_agent_state")
    .select("status, current_task, last_error, last_action_at, last_error_at, busy_since, pending_task")
    .eq("id", 1)
    .maybeSingle()
  return (data as AgentState) || null
}

export async function loadConfig(): Promise<AgentConfig | null> {
  const { data } = await supabaseAdmin
    .from("mengmegzi_config")
    .select("comment_polling_enabled, comment_interval_min, comment_scan_hours, busy_timeout_min, image_sources")
    .eq("id", 1)
    .maybeSingle()
  return (data as AgentConfig) || null
}

/** 进入 busy：status=busy, busy_since=now, current_task=描述 */
export async function markBusy(currentTask: string): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({
      status: "busy",
      current_task: currentTask,
      busy_since: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
}

/** 成功完成：status=idle, 清 current_task, 更新 last_action_at */
export async function markIdle(): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({
      status: "idle",
      current_task: "",
      busy_since: null,
      last_action_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
}

/** 死机：status=dead, last_error, last_error_at */
export async function markDead(error: string): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({
      status: "dead",
      current_task: "",
      busy_since: null,
      last_error: error,
      last_error_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
}

/** 重置：dead → idle，清错误和 pending_task（面板"重置"按钮用） */
export async function resetState(): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({
      status: "idle",
      current_task: "",
      last_error: "",
      busy_since: null,
      pending_task: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
}

/** 写 pending_task（单发指令用，不改 status） */
export async function setPendingTask(task: PendingTask): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({ pending_task: task, updated_at: new Date().toISOString() })
    .eq("id", 1)
}

/** 清 pending_task（执行完后） */
export async function clearPendingTask(): Promise<void> {
  await supabaseAdmin
    .from("mengmegzi_agent_state")
    .update({ pending_task: null, updated_at: new Date().toISOString() })
    .eq("id", 1)
}

/** 写日志 */
export async function logAction(
  actionType: "post" | "comment" | "reply",
  targetId: string | null,
  result: "success" | "error",
  detail: string,
): Promise<void> {
  await supabaseAdmin.from("mengmegzi_action_log").insert({
    action_type: actionType,
    target_id: targetId,
    result,
    detail,
  })
}
```

- [ ] **Step 2: 验证类型编译**

```bash
npx tsc --noEmit lib/mengmegzi/state.ts
```
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add lib/mengmegzi/state.ts
git commit -m "feat(mengmegzi): state machine read/write + pending task"
```

---

## Task 8: 执行内核

**Files:**
- Create: `lib/mengmegzi/executor.ts`

- [ ] **Step 1: 写实现**

```typescript
// lib/mengmegzi/executor.ts
//
// 执行内核：发帖/留言/回复三个函数。
// 每个函数失败抛错（由 tick catch 后 markDead），图片相关失败内部降级不抛。
// 调用前调用方应已 markBusy，调用后调用方 markIdle/markDead。

import { createClient } from "@supabase/supabase-js"
import { loadDmAiConfig } from "@/lib/hanako/dm-ai"
import {
  MENGMEGZI_USER_ID,
  ALL_CATEGORIES,
  POST_TEMPERATURE,
  COMMENT_TEMPERATURE,
  MAX_AGENT_TOKENS,
} from "./constants"
import {
  buildPostSystemPrompt,
  buildPostUserMessage,
  buildCommentSystemPrompt,
  buildCommentUserMessage,
  buildReplySystemPrompt,
  buildReplyUserMessage,
  type TargetPost,
} from "./prompts"
import { callAiForJson } from "./ai-client"
import { fetchImageForCategory, type ImageSourceConfig } from "./image-sources"
import { downloadCompressUpload } from "./image-pipeline"
import { loadConfig, logAction } from "./state"
import type { CategoryValue } from "@/lib/categories"
import { isValidCategory } from "@/lib/categories"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

/** 随机选一个分类（保证 6 类均匀） */
function pickRandomCategory(): CategoryValue {
  const idx = Math.floor(Math.random() * ALL_CATEGORIES.length)
  return ALL_CATEGORIES[idx] as CategoryValue
}

interface PostGen {
  title: string
  content: string
  description: string
}

/**
 * 发帖：AI 生成文字 → 按分类配图 → 写 posts 表。
 * 图片相关失败降级纯文字帖，不抛错；AI/写库失败抛错。
 */
export async function executePost(forcedCategory?: CategoryValue): Promise<string> {
  const cfg = await loadDmAiConfig()
  const agentCfg = await loadConfig()
  const category = forcedCategory && isValidCategory(forcedCategory) ? forcedCategory : pickRandomCategory()

  // 1. AI 生成
  const messages = [
    { role: "system" as const, content: buildPostSystemPrompt(cfg.persona) },
    { role: "user" as const, content: buildPostUserMessage(category) },
  ]
  const gen = (await callAiForJson(cfg, messages, POST_TEMPERATURE, MAX_AGENT_TOKENS)) as PostGen
  if (!gen?.title || !gen?.content) {
    throw new Error("AI 输出缺 title/content")
  }

  // 2. 配图（失败降级纯文字）
  let imageUrl: string | null = null
  let imageRatio: number | null = null
  const srcCfg = (agentCfg?.image_sources?.[category] as ImageSourceConfig) || { provider: "none" }
  const img = await fetchImageForCategory(category, srcCfg)
  if (img) {
    // 先 insert 拿 post_id，再传图（图路径要用 post_id）
    // 但 image_url 要在 insert 时一起写——故先插无图，再更新图。
    // 简化：用临时 uuid 作路径，insert 时带图。
    const tempId = crypto.randomUUID()
    const processed = await downloadCompressUpload(img.url, tempId)
    if (processed) {
      imageUrl = processed.publicUrl
      imageRatio = processed.ratio
    }
  }

  // 3. 写 posts
  const { data, error } = await supabaseAdmin
    .from("posts")
    .insert([
      {
        title: gen.title,
        content: gen.content,
        description: gen.description || "",
        category,
        image_url: imageUrl,
        image_urls: imageUrl ? [imageUrl] : null,
        image_ratio: imageRatio,
        user_id: MENGMEGZI_USER_ID,
        likes: 0,
        comments: 0,
      },
    ])
    .select("id")
    .single()
  if (error) throw new Error(`写 posts 失败: ${error.message}`)

  await logAction("post", null, "success", data.id)
  return data.id
}

/**
 * 留言：读目标帖 → AI 生成评论 → 写 comments 表。
 * 帖子不存在/AI 失败/写库失败抛错。
 */
export async function executeComment(postId: string): Promise<string> {
  const cfg = await loadDmAiConfig()
  const { data: post, error: pErr } = await supabaseAdmin
    .from("posts")
    .select("id, title, content, category")
    .eq("id", postId)
    .maybeSingle()
  if (pErr || !post) throw new Error(`帖子 ${postId} 不存在`)

  const target: TargetPost = post
  const messages = [
    { role: "system" as const, content: buildCommentSystemPrompt(cfg.persona) },
    { role: "user" as const, content: buildCommentUserMessage(target) },
  ]
  const gen = (await callAiForJson(cfg, messages, COMMENT_TEMPERATURE, MAX_AGENT_TOKENS)) as {
    content: string
  }
  if (!gen?.content) throw new Error("AI 输出缺 content")

  const { data, error } = await supabaseAdmin
    .from("comments")
    .insert([
      {
        post_id: postId,
        user_id: MENGMEGZI_USER_ID,
        content: gen.content,
      },
    ])
    .select("id")
    .single()
  if (error) throw new Error(`写 comments 失败: ${error.message}`)

  await logAction("comment", postId, "success", data.id)
  return data.id
}

/**
 * 回复：读被回复的评论 + 其所属帖 → AI 生成回复 → 写 comments（带 parent_id）。
 */
export async function executeReply(commentId: string): Promise<string> {
  const cfg = await loadDmAiConfig()
  const { data: comment, error: cErr } = await supabaseAdmin
    .from("comments")
    .select("id, content, post_id")
    .eq("id", commentId)
    .maybeSingle()
  if (cErr || !comment) throw new Error(`评论 ${commentId} 不存在`)

  const { data: post, error: pErr } = await supabaseAdmin
    .from("posts")
    .select("id, title, content, category")
    .eq("id", comment.post_id)
    .maybeSingle()
  if (pErr || !post) throw new Error(`帖子 ${comment.post_id} 不存在`)

  const target: TargetPost = post
  const messages = [
    { role: "system" as const, content: buildReplySystemPrompt(cfg.persona) },
    { role: "user" as const, content: buildReplyUserMessage(target, { content: comment.content }) },
  ]
  const gen = (await callAiForJson(cfg, messages, COMMENT_TEMPERATURE, MAX_AGENT_TOKENS)) as {
    content: string
  }
  if (!gen?.content) throw new Error("AI 输出缺 content")

  const { data, error } = await supabaseAdmin
    .from("comments")
    .insert([
      {
        post_id: comment.post_id,
        user_id: MENGMEGZI_USER_ID,
        content: gen.content,
        parent_id: commentId,
      },
    ])
    .select("id")
    .single()
  if (error) throw new Error(`写 comments 失败: ${error.message}`)

  await logAction("reply", commentId, "success", data.id)
  return data.id
}

// ── 轮询目标筛选（tick 用） ──

/** 找一个可留言的新帖（最近 N 小时、非萌萌子、未留过言） */
export async function findCommentablePost(scanHours: number): Promise<string | null> {
  const since = new Date(Date.now() - scanHours * 3600 * 1000).toISOString()
  // 查已成功留言过的帖子 id
  const { data: done } = await supabaseAdmin
    .from("mengmegzi_action_log")
    .select("target_id")
    .eq("action_type", "comment")
    .eq("result", "success")
  const doneIds = new Set((done || []).map((r: any) => r.target_id))

  const { data: posts } = await supabaseAdmin
    .from("posts")
    .select("id")
    .gt("created_at", since)
    .neq("user_id", MENGMEGZI_USER_ID)
    .order("created_at", { ascending: false })
    .limit(200)

  const candidates = (posts || []).filter((p: any) => !doneIds.has(p.id))
  if (candidates.length === 0) return null
  const pick = candidates[Math.floor(Math.random() * candidates.length)]
  return pick.id
}

/** 找一个待回复的评论（在萌萌子帖下、非萌萌子发的、没回复过） */
export async function findReplyableComment(): Promise<string | null> {
  // 萌萌子的帖 id 集合
  const { data: myPosts } = await supabaseAdmin
    .from("posts")
    .select("id")
    .eq("user_id", MENGMEGZI_USER_ID)
  const myPostIds = (myPosts || []).map((p: any) => p.id)
  if (myPostIds.length === 0) return null

  // 已回复过的评论 id
  const { data: done } = await supabaseAdmin
    .from("mengmegzi_action_log")
    .select("target_id")
    .eq("action_type", "reply")
    .eq("result", "success")
  const doneIds = new Set((done || []).map((r: any) => r.target_id))

  const { data: comments } = await supabaseAdmin
    .from("comments")
    .select("id")
    .in("post_id", myPostIds)
    .neq("user_id", MENGMEGZI_USER_ID)
    .order("created_at", { ascending: true })
    .limit(200)

  const candidates = (comments || []).filter((c: any) => !doneIds.has(c.id))
  if (candidates.length === 0) return null
  return candidates[0].id
}
```

- [ ] **Step 2: 验证类型编译**

```bash
npx tsc --noEmit lib/mengmegzi/executor.ts
```
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add lib/mengmegzi/executor.ts
git commit -m "feat(mengmegzi): executor core (post/comment/reply + target finders)"
```

---

## Task 9: Admin 端点 - 状态 & 配置

**Files:**
- Create: `app/api/admin/mengmegzi-agent/state/route.ts`
- Create: `app/api/admin/mengmegzi-agent/config/route.ts`

- [ ] **Step 1: 写 state 端点**

```typescript
// app/api/admin/mengmegzi-agent/state/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { resetState } from "@/lib/mengmegzi/state"

export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function requireAdmin(req: NextRequest) {
  const token = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.slice(7).trim()
    : ""
  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 })
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !auth?.user) return NextResponse.json({ error: "认证失败" }, { status: 401 })
  const { data: adminRow } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle()
  if (!adminRow) return NextResponse.json({ error: "无权限" }, { status: 403 })
  return null
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const { data } = await supabaseAdmin
    .from("mengmegzi_agent_state")
    .select("status, current_task, last_error, last_action_at, last_error_at, busy_since, pending_task, updated_at")
    .eq("id", 1)
    .maybeSingle()
  return NextResponse.json(data || {})
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as { action?: "reset" }
  if (body.action === "reset") {
    await resetState()
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: "未知 action" }, { status: 400 })
}
```

- [ ] **Step 2: 写 config 端点**

```typescript
// app/api/admin/mengmegzi-agent/config/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function requireAdmin(req: NextRequest) {
  const token = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.slice(7).trim()
    : ""
  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 })
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !auth?.user) return NextResponse.json({ error: "认证失败" }, { status: 401 })
  const { data: adminRow } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle()
  if (!adminRow) return NextResponse.json({ error: "无权限" }, { status: 403 })
  return null
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const { data } = await supabaseAdmin
    .from("mengmegzi_config")
    .select("comment_polling_enabled, comment_interval_min, comment_scan_hours, busy_timeout_min, image_sources, updated_at")
    .eq("id", 1)
    .maybeSingle()
  return NextResponse.json(data || {})
}

export async function PATCH(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as {
    comment_polling_enabled?: boolean
    comment_interval_min?: number
    comment_scan_hours?: number
    busy_timeout_min?: number
  }
  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (typeof body.comment_polling_enabled === "boolean") patch.comment_polling_enabled = body.comment_polling_enabled
  if (typeof body.comment_interval_min === "number") patch.comment_interval_min = Math.min(Math.max(Math.round(body.comment_interval_min), 1), 1440)
  if (typeof body.comment_scan_hours === "number") patch.comment_scan_hours = Math.min(Math.max(Math.round(body.comment_scan_hours), 1), 168)
  if (typeof body.busy_timeout_min === "number") patch.busy_timeout_min = Math.min(Math.max(Math.round(body.busy_timeout_min), 1), 60)
  const { error } = await supabaseAdmin.from("mengmegzi_config").update(patch).eq("id", 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/mengmegzi-agent/state/route.ts app/api/admin/mengmegzi-agent/config/route.ts
git commit -m "feat(mengmegzi): admin state/config endpoints"
```

---

## Task 10: Admin 端点 - 指令 & 日志

**Files:**
- Create: `app/api/admin/mengmegzi-agent/command/route.ts`
- Create: `app/api/admin/mengmegzi-agent/log/route.ts`

- [ ] **Step 1: 写 command 端点**

```typescript
// app/api/admin/mengmegzi-agent/command/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { loadState, setPendingTask, type PendingTask } from "@/lib/mengmegzi/state"
import { ALL_CATEGORIES } from "@/lib/mengmegzi/constants"
import type { CategoryValue } from "@/lib/categories"
import { isValidCategory } from "@/lib/categories"

export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function requireAdmin(req: NextRequest) {
  const token = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.slice(7).trim()
    : ""
  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 })
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !auth?.user) return NextResponse.json({ error: "认证失败" }, { status: 401 })
  const { data: adminRow } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle()
  if (!adminRow) return NextResponse.json({ error: "无权限" }, { status: 403 })
  return null
}

function pickRandomCategory(): CategoryValue {
  return ALL_CATEGORIES[Math.floor(Math.random() * ALL_CATEGORIES.length)] as CategoryValue
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as {
    action: string
    post_id?: string
    comment_id?: string
    category?: string
  }

  // 轮询开关：直接改 config
  if (body.action === "start_comment_polling" || body.action === "stop_comment_polling") {
    const enabled = body.action === "start_comment_polling"
    const { error } = await supabaseAdmin
      .from("mengmegzi_config")
      .update({ comment_polling_enabled: enabled, updated_at: new Date().toISOString() })
      .eq("id", 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, polling: enabled })
  }

  // 单发指令：写 pending_task
  const state = await loadState()
  if (!state) return NextResponse.json({ error: "状态表未初始化" }, { status: 500 })
  if (state.status === "dead") {
    return NextResponse.json({ error: "当前死机，请先重置" }, { status: 409 })
  }
  if (state.pending_task) {
    return NextResponse.json({ error: "已有待办任务在排队" }, { status: 409 })
  }

  let task: PendingTask
  if (body.action === "post_now") {
    const cat = body.category && isValidCategory(body.category) ? (body.category as CategoryValue) : pickRandomCategory()
    task = { type: "post", category: cat, queued_at: new Date().toISOString() }
  } else if (body.action === "comment_now") {
    if (!body.post_id) return NextResponse.json({ error: "缺 post_id" }, { status: 400 })
    task = { type: "comment", target_post_id: body.post_id, queued_at: new Date().toISOString() }
  } else if (body.action === "reply_now") {
    if (!body.comment_id) return NextResponse.json({ error: "缺 comment_id" }, { status: 400 })
    task = { type: "reply", target_comment_id: body.comment_id, queued_at: new Date().toISOString() }
  } else {
    return NextResponse.json({ error: "未知 action" }, { status: 400 })
  }

  await setPendingTask(task)
  return NextResponse.json({ ok: true, accepted: true }, { status: 202 })
}
```

- [ ] **Step 2: 写 log 端点**

```typescript
// app/api/admin/mengmegzi-agent/log/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

async function requireAdmin(req: NextRequest) {
  const token = req.headers.get("authorization")?.startsWith("Bearer ")
    ? req.headers.get("authorization")!.slice(7).trim()
    : ""
  if (!token) return NextResponse.json({ error: "未登录" }, { status: 401 })
  const { data: auth, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !auth?.user) return NextResponse.json({ error: "认证失败" }, { status: 401 })
  const { data: adminRow } = await supabaseAdmin
    .from("admin_users")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle()
  if (!adminRow) return NextResponse.json({ error: "无权限" }, { status: 403 })
  return null
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req)
  if (denied) return denied
  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200)
  const { data } = await supabaseAdmin
    .from("mengmegzi_action_log")
    .select("id, action_type, target_id, result, detail, created_at")
    .order("created_at", { ascending: false })
    .limit(limit)
  return NextResponse.json(data || [])
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/mengmegzi-agent/command/route.ts app/api/admin/mengmegzi-agent/log/route.ts
git commit -m "feat(mengmegzi): admin command/log endpoints"
```

---

## Task 11: Tick 端点

**Files:**
- Create: `app/api/mengmegzi-tick/route.ts`

- [ ] **Step 1: 写实现**

```typescript
// app/api/mengmegzi-tick/route.ts
//
// CF Worker Cron 每 2 分钟戳一次。读状态决定执行单发任务或轮询。
// 走 cron 密钥校验，不走 admin 鉴权。

import { NextRequest, NextResponse } from "next/server"
import {
  loadState,
  loadConfig,
  markBusy,
  markIdle,
  markDead,
  clearPendingTask,
} from "@/lib/mengmegzi/state"
import {
  executePost,
  executeComment,
  executeReply,
  findCommentablePost,
  findReplyableComment,
} from "@/lib/mengmegzi/executor"
import { logAction } from "@/lib/mengmegzi/state"
import type { CategoryValue } from "@/lib/categories"
import { isValidCategory } from "@/lib/categories"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  // 1. 密钥校验
  const secret = req.headers.get("x-cron-secret")
  if (!secret || secret !== process.env.MENGMEGZI_CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    await runTick()
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[mengmegzi-tick] 异常:", e?.message || e)
    return NextResponse.json({ error: e?.message || "tick failed" }, { status: 500 })
  }
}

async function runTick(): Promise<void> {
  const state = await loadState()
  if (!state) return
  const cfg = await loadConfig()
  if (!cfg) return

  // 2. 死机不动
  if (state.status === "dead") return

  // 3. busy：判超时
  if (state.status === "busy") {
    if (state.busy_since) {
      const elapsed = Date.now() - new Date(state.busy_since).getTime()
      if (elapsed > cfg.busy_timeout_min * 60 * 1000) {
        await markDead(`执行超时(>${cfg.busy_timeout_min}min)`)
        await logAction("post", null, "error", `超时: busy_since=${state.busy_since}`)
      }
    }
    return
  }

  // 4. idle：先看 pending_task
  if (state.pending_task) {
    await runPendingTask(state.pending_task)
    return
  }

  // 5. 轮询
  if (!cfg.comment_polling_enabled) return
  const since = state.last_action_at ? new Date(state.last_action_at).getTime() : 0
  const elapsed = Date.now() - since
  if (elapsed < cfg.comment_interval_min * 60 * 1000) return

  // 回复优先 > 留言
  const replyTarget = await findReplyableComment()
  if (replyTarget) {
    await runTask("reply", "正在回复评论 " + replyTarget, () => executeReply(replyTarget), replyTarget, "reply")
    return
  }
  const commentTarget = await findCommentablePost(cfg.comment_scan_hours)
  if (commentTarget) {
    await runTask("comment", "正在给帖子留言 " + commentTarget, () => executeComment(commentTarget), commentTarget, "comment")
    return
  }
}

async function runPendingTask(task: any): Promise<void> {
  await clearPendingTask() // 先清，防执行中又来 tick 重复执行
  if (task.type === "post") {
    const cat = task.category && isValidCategory(task.category) ? (task.category as CategoryValue) : undefined
    await runTask("post", "正在发帖", () => executePost(cat), null, "post")
  } else if (task.type === "comment") {
    await runTask("comment", "正在给帖子留言 " + task.target_post_id, () => executeComment(task.target_post_id), task.target_post_id, "comment")
  } else if (task.type === "reply") {
    await runTask("reply", "正在回复评论 " + task.target_comment_id, () => executeReply(task.target_comment_id), task.target_comment_id, "reply")
  }
}

async function runTask(
  _actionType: "post" | "comment" | "reply",
  desc: string,
  fn: () => Promise<string>,
  _targetId: string | null,
  _logType: "post" | "comment" | "reply",
): Promise<void> {
  await markBusy(desc)
  try {
    await fn()
    await markIdle()
  } catch (e: any) {
    const msg = e?.message || String(e)
    await markDead(msg)
    await logAction(_logType, _targetId, "error", msg)
  }
}
```

- [ ] **Step 2: 验证类型编译**

```bash
npx tsc --noEmit app/api/mengmegzi-tick/route.ts
```
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add app/api/mengmegzi-tick/route.ts
git commit -m "feat(mengmegzi): cron tick endpoint"
```

---

## Task 12: 面板 UI 组件

**Files:**
- Create: `components/admin/mengmegzi-agent-panel.tsx`

- [ ] **Step 1: 写实现**

```tsx
// components/admin/mengmegzi-agent-panel.tsx
"use client"

import { useEffect, useState, useCallback } from "react"
import { supabase } from "@/lib/supabaseClient"
import { apiUrl } from "@/lib/api-base"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { RefreshCw, Send, MessageSquare, Reply, Power } from "lucide-react"

type Status = "idle" | "busy" | "dead"

interface StateData {
  status: Status
  current_task: string
  last_error: string
  last_action_at: string | null
  last_error_at: string | null
  pending_task: any
}

interface ConfigData {
  comment_polling_enabled: boolean
  comment_interval_min: number
  comment_scan_hours: number
  busy_timeout_min: number
}

interface LogRow {
  id: number
  action_type: string
  target_id: string | null
  result: string
  detail: string
  created_at: string
}

function authHeaders(): Record<string, string> {
  const session = supabase.auth.session()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

const STATUS_LABEL: Record<Status, string> = { idle: "休息中", busy: "行动中", dead: "死机" }
const STATUS_DOT: Record<Status, string> = { idle: "bg-gray-400", busy: "bg-green-400 animate-pulse", dead: "bg-red-500" }

export default function MengmegziAgentPanel() {
  const [state, setState] = useState<StateData | null>(null)
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [logs, setLogs] = useState<LogRow[]>([])
  const [postId, setPostId] = useState("")
  const [commentId, setCommentId] = useState("")
  const [sending, setSending] = useState(false)

  const refreshAll = useCallback(async () => {
    const h = authHeaders()
    const [s, c, l] = await Promise.all([
      fetch(apiUrl("/api/admin/mengmegzi-agent/state"), { headers: h }).then((r) => r.json()),
      fetch(apiUrl("/api/admin/mengmegzi-agent/config"), { headers: h }).then((r) => r.json()),
      fetch(apiUrl("/api/admin/mengmegzi-agent/log?limit=50"), { headers: h }).then((r) => r.json()),
    ])
    setState(s)
    setConfig(c)
    setLogs(Array.isArray(l) ? l : [])
  }, [])

  useEffect(() => {
    refreshAll()
    const t = setInterval(refreshAll, 10000)
    return () => clearInterval(t)
  }, [refreshAll])

  async function sendCommand(body: any) {
    setSending(true)
    try {
      const res = await fetch(apiUrl("/api/admin/mengmegzi-agent/command"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) alert(data.error || "指令失败")
      else alert("已受理，等待 tick 执行")
      await refreshAll()
    } finally {
      setSending(false)
    }
  }

  async function resetState() {
    await fetch(apiUrl("/api/admin/mengmegzi-agent/state"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ action: "reset" }),
    })
    await refreshAll()
  }

  async function saveConfig() {
    if (!config) return
    await fetch(apiUrl("/api/admin/mengmegzi-agent/config"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(config),
    })
    alert("配置已保存")
  }

  const disabled = state?.status === "dead"

  return (
    <div className="space-y-4">
      {/* 状态卡 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className={`inline-block h-3 w-3 rounded-full ${state ? STATUS_DOT[state.status] : "bg-gray-400"}`} />
            {state ? STATUS_LABEL[state.status] : "加载中..."}
            <Button variant="outline" size="sm" onClick={refreshAll} className="ml-auto">
              <RefreshCw className="h-4 w-4" />
            </Button>
            {state?.status === "dead" && (
              <Button variant="destructive" size="sm" onClick={resetState}>
                重置
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {state?.current_task && <div>当前任务：{state.current_task}</div>}
          {state?.last_action_at && <div>上次行动：{new Date(state.last_action_at).toLocaleString()}</div>}
          {state?.status === "dead" && state.last_error && (
            <div className="text-red-500">最近错误：{state.last_error}</div>
          )}
        </CardContent>
      </Card>

      {/* 指令卡 */}
      <Card>
        <CardHeader><CardTitle>指令</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Button disabled={disabled || sending} onClick={() => sendCommand({ action: "post_now" })}>
              <Send className="h-4 w-4 mr-1" />发一帖
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="帖子 ID" value={postId} onChange={(e) => setPostId(e.target.value)} disabled={disabled} />
            <Button disabled={disabled || sending || !postId} onClick={() => sendCommand({ action: "comment_now", post_id: postId })}>
              <MessageSquare className="h-4 w-4 mr-1" />给该帖留言
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input placeholder="评论 ID" value={commentId} onChange={(e) => setCommentId(e.target.value)} disabled={disabled} />
            <Button disabled={disabled || sending || !commentId} onClick={() => sendCommand({ action: "reply_now", comment_id: commentId })}>
              <Reply className="h-4 w-4 mr-1" />回复该评论
            </Button>
          </div>
          <div className="flex items-center gap-2 pt-2 border-t">
            <Power className="h-4 w-4" />
            <span>留言+回复轮询</span>
            <Switch
              checked={config?.comment_polling_enabled || false}
              onCheckedChange={(v) => sendCommand({ action: v ? "start_comment_polling" : "stop_comment_polling" })}
            />
          </div>
        </CardContent>
      </Card>

      {/* 配置卡 */}
      <Card>
        <CardHeader><CardTitle>配置</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {config && (
            <>
              <label className="flex items-center gap-2">
                留言节奏（分钟）：
                <Input
                  type="number"
                  value={config.comment_interval_min}
                  onChange={(e) => setConfig({ ...config, comment_interval_min: parseInt(e.target.value, 10) || 30 })}
                  className="w-24"
                />
              </label>
              <label className="flex items-center gap-2">
                扫描最近多少小时新帖：
                <Input
                  type="number"
                  value={config.comment_scan_hours}
                  onChange={(e) => setConfig({ ...config, comment_scan_hours: parseInt(e.target.value, 10) || 24 })}
                  className="w-24"
                />
              </label>
              <label className="flex items-center gap-2">
                busy 超时（分钟）：
                <Input
                  type="number"
                  value={config.busy_timeout_min}
                  onChange={(e) => setConfig({ ...config, busy_timeout_min: parseInt(e.target.value, 10) || 5 })}
                  className="w-24"
                />
              </label>
              <Button onClick={saveConfig}>保存配置</Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* 日志卡 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            日志
            <Button variant="outline" size="sm" onClick={refreshAll} className="ml-auto">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-1">时间</th>
                  <th>类型</th>
                  <th>结果</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b">
                    <td className="py-1 pr-2">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="pr-2">{l.action_type}</td>
                    <td className={l.result === "success" ? "text-green-600" : "text-red-500"}>{l.result}</td>
                    <td className="break-all">{l.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/admin/mengmegzi-agent-panel.tsx
git commit -m "feat(mengmegzi): admin panel UI component"
```

---

## Task 13: 挂载面板到 admin 页

**Files:**
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: 读现有 Tabs 结构**

打开 `app/admin/page.tsx`，找到 `<Tabs>` 和 `<TabsList>` 块，记下现有 TabsTrigger 的 value 和 TabsContent 的写法。

- [ ] **Step 2: 加 import**

在文件顶部 import 区加：
```tsx
import MengmegziAgentPanel from "@/components/admin/mengmegzi-agent-panel"
```

- [ ] **Step 3: 加 TabsTrigger**

在 `<TabsList>` 里最后一个 `<TabsTrigger>` 后面加：
```tsx
<TabsTrigger value="mengmegzi" className="flex items-center gap-2">
  <Bot className="h-4 w-4" />
  萌萌子
</TabsTrigger>
```

- [ ] **Step 4: 加 TabsContent**

在最后一个 `<TabsContent>` 后面加：
```tsx
<TabsContent value="mengmegzi">
  <MengmegziAgentPanel />
</TabsContent>
```

- [ ] **Step 5: 本地验证**

```bash
npm run dev
```
浏览器打开 `/admin`，点"萌萌子" Tab，确认面板渲染（状态卡/指令卡/配置卡/日志卡都显示，数据可能为空属正常）。

- [ ] **Step 6: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat(mengmegzi): mount agent panel in admin page"
```

---

## Task 14: CF Worker Cron 改动

**Files:**
- Modify: `cloudflare/presence-worker/wrangler.toml`
- Modify: `cloudflare/presence-worker/src/index.ts`

- [ ] **Step 1: 改 wrangler.toml 加 cron**

```toml
# 主动私信触发器：cron 每 5 分钟扫描在线用户
# 萌萌子 agent tick：cron 每 2 分钟戳 /api/mengmegzi-tick
[triggers]
crons = ["*/5 * * * *", "*/2 * * * *"]
```

并在 `[vars]` 区加：
```toml
MENGMEGZI_TICK_URL = "https://hanakos.cc/api/mengmegzi-tick"
```

- [ ] **Step 2: 改 index.ts scheduled handler**

```typescript
// cloudflare/presence-worker/src/index.ts 的 Env 接口加字段：
export interface Env {
  PRESENCE: DurableObjectNamespace
  SUPABASE_JWT_SECRET: string
  PRESENCE_ENABLED: string
  ALLOWED_ORIGINS: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  MENGMEGZI_USER_ID: string
  // 萌萌子 agent tick（新增）
  MENGMEGZI_TICK_URL: string
  MENGMEGZI_CRON_SECRET: string
}
```

改 scheduled handler，按 cron 表达式分流：
```typescript
async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  // */5 走主动私信
  if (event.cron === "*/5 * * * *") {
    ctx.waitUntil(
      runProactiveSweep(env).catch((err) => {
        console.error("[proactive] 扫描异常:", err?.message || err)
      }),
    )
    return
  }
  // */2 走萌萌子 tick
  if (event.cron === "*/2 * * * *") {
    ctx.waitUntil(
      tickMengmegzi(env).catch((err) => {
        console.error("[mengmegzi-tick] 异常:", err?.message || err)
      }),
    )
    return
  }
},
```

- [ ] **Step 3: 加 tickMengmegzi 函数**

在 `cloudflare/presence-worker/src/index.ts` 末尾（或单独文件）加：

```typescript
/** 萌萌子 agent tick：戳 Next.js 的 /api/mengmegzi-tick */
async function tickMengmegzi(env: Env): Promise<void> {
  const url = env.MENGMEGZI_TICK_URL
  if (!url) return
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-cron-secret": env.MENGMEGZI_CRON_SECRET },
  })
  if (!res.ok) {
    console.warn("[mengmegzi-tick] 非 2xx:", res.status, await res.text().catch(() => ""))
  }
}
```

- [ ] **Step 4: 设置 wrangler secret**

```bash
cd cloudflare/presence-worker
npx wrangler secret put MENGMEGZI_CRON_SECRET
# 粘贴与 .env.local 里 MENGMEGZI_CRON_SECRET 相同的值
cd ../..
```

- [ ] **Step 5: 部署 worker**

```bash
cd cloudflare/presence-worker
npx wrangler deploy
cd ../..
```

- [ ] **Step 6: Commit**

```bash
git add cloudflare/presence-worker/wrangler.toml cloudflare/presence-worker/src/index.ts
git commit -m "feat(mengmegzi): CF Worker cron triggers tick endpoint"
```

---

## Task 15: 端到端验证

- [ ] **Step 1: 本地起服务**

```bash
npm run dev
```

- [ ] **Step 2: 配置 dm_ai_config**

浏览器打开 `/admin`，找到"私信 AI 配置"卡片，把那个巨额 token 文本 AI 的 `base_url/api_key/model` 填进去，`enabled=true`，保存。

- [ ] **Step 3: 验证状态卡**

切到"萌萌子" Tab，确认状态显示"休息中"。

- [ ] **Step 4: 单发发帖测试**

点"发一帖"。预期：
- 立刻弹"已受理"
- 等 ≤2 分钟，状态变"行动中"，current_task="正在发帖"
- 几秒~几分钟后，状态回"休息中"，日志卡出现一条 `post / success`
- 去首页刷新，确认新帖出现（有图或纯文字）

- [ ] **Step 5: 单发留言测试**

从首页找一个帖子复制其 id，填入"帖子 ID"，点"给该帖留言"。预期同上，日志出现 `comment / success`，去帖子详情确认评论出现。

- [ ] **Step 6: 单发回复测试**

找一个别人在萌萌子帖下的评论（或自己造一条），复制评论 id，点"回复该评论"。预期日志 `reply / success`。

- [ ] **Step 7: 轮询测试**

打开"留言+回复轮询" Switch。等待 `comment_interval_min`（默认 30 分钟，可临时改小到 2 分钟测）。确认 tick 自动触发了留言或回复（日志增加）。

- [ ] **Step 8: 死机恢复测试**

临时把 `dm_ai_config.api_key` 改错，点"发一帖"。预期：
- 状态变"死机"，last_error 显示 AI 调用失败
- 指令卡按钮置灰
- 点"重置"，状态回"休息中"，按钮恢复

改回正确 api_key。

- [ ] **Step 9: 关轮询验证**

关掉 Switch，确认 tick 不再触发新行动（日志不再增长，状态保持休息中）。

- [ ] **Step 10: 全部通过后 Commit**

```bash
git add -A
git commit -m "test(mengmegzi): e2e verification complete"
```

---

## Self-Review 记录

**Spec coverage 检查**：
- §1 数据表 → Task 1 ✓
- §2 API 端点（5 个）→ Task 9/10/11 ✓
- §3 Prompt → Task 5 ✓
- §4 状态机 + 图源 → Task 3/4/7 ✓
- §5 面板 UI → Task 12/13 ✓
- §6 执行内核 → Task 8 ✓
- §7 Prompt 细节 → Task 5 ✓
- §8 JSON 解析 → Task 6 ✓
- §9 状态机流转 → Task 7/11 ✓
- §11 CF Worker → Task 14 ✓
- §12 环境变量 → Task 2 ✓
- §13 失败兜底 → Task 8（图片降级）/Task 11（死机）✓
- §15 实现顺序 → Task 顺序与 spec 一致 ✓

**类型一致性检查**：
- `executePost` 签名 `(forcedCategory?: CategoryValue) => Promise<string>` — Task 8 定义，Task 11 调用一致 ✓
- `findCommentablePost(scanHours: number) => Promise<string|null>` — Task 8 定义，Task 11 调用一致 ✓
- `PendingTask` 接口 — Task 7 定义，Task 10/11 使用一致 ✓
- `markBusy/markIdle/markDead/resetState` — Task 7 定义，Task 11 调用一致 ✓

**无占位符**：所有步骤含完整代码，无 TBD/TODO。
