# 萌萌子主动私信在线用户 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Cloudflare presence worker 加一个 cron 每 5 分钟的定时扫描触发器，让萌萌子按护栏规则主动给在线已验证用户发零 token 模板开场白（文字 + happy 表情包）。

**Architecture:** 在现有 `cloudflare/presence-worker` 里新增 `scheduled()` handler。cron 触发时：读 `dm_ai_config.proactive_enabled` 开关 → 通过 DO stub 拿在线 userId 列表 → 用裸 `fetch` 调 Supabase REST 批量查护栏状态 + RPC `email_verification_required` 硬过滤 → 给通过的用户插 2 行 `dm_messages`（文字 + `[s:happy]`）→ upsert `hanako_dm_state`。客户端、反应式路由、DB schema 全部零改动。

**Tech Stack:** Cloudflare Workers + Durable Objects（WebSocket Hibernation）、Supabase REST API（service_role）、TypeScript。worker 现有依赖仅 `jose`，不引入 supabase-js。

**Spec:** `docs/superpowers/specs/2026-06-18-mengmegzi-proactive-dm-design.md`

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `cloudflare/presence-worker/wrangler.toml` | 修改 | 加 `[triggers] crons` + `[vars]` 加 `SUPABASE_URL` / `MENGMEGZI_USER_ID` |
| `cloudflare/presence-worker/src/index.ts` | 修改 | `Env` 接口加新字段；export default 加 `scheduled()` handler；`fetch` 里加 DO `/online` 路由转发 |
| `cloudflare/presence-worker/src/presence-room.ts` | 修改 | DO `fetch` 加 `/online` 分支返回在线 userId 数组 |
| `cloudflare/presence-worker/src/proactive.ts` | 新建 | 触发器主体 `runProactiveSweep(env)` + OPENER_TEMPLATES 副本 + `pickOpener` + Supabase REST 辅助函数 |
| `cloudflare/presence-worker/src/proactive.test.ts` | 新建 | 护栏过滤逻辑的纯函数单测（用 vitest 或 node:test） |

> **模板两处需同步**：`lib/hanako/dm-ai.ts:140` 的 `OPENER_TEMPLATES` / `pickOpener` 会在 `src/proactive.ts` 复制一份。改动模板时两处都要改。worker 不能 import Next.js 代码（不同 tsconfig / 不同部署单元）。

> **worker 无测试框架**：`package.json` 只有 `typecheck`。本计划用 `node --test`（Node 内置 test runner，零依赖）跑纯函数单测，不引入 vitest。护栏过滤是纯函数，易测；Supabase REST 调用是 I/O，不单测（靠 `wrangler tail` 观察集成行为）。

> **环境约定（重要，所有 subagent 遵守）**：本机 `node.exe` 在 `F:\code\node.exe`（v22.16.0），但 cmd 子进程 PATH 不稳定，`npx`/`node` 常报"不是内部命令"。所有命令必须用**完整路径**调用：
> - typecheck：`"F:\code\node.exe" "I:\next-template-main_2026_05_26\next-template-main_2026_5_29\next-template-main\next-template-main\cloudflare\presence-worker\node_modules\typescript\bin\tsc" --noEmit -p "I:\next-template-main_2026_05_26\next-template-main_2026_5_29\next-template-main\next-template-main\cloudflare\presence-worker\tsconfig.json"`（在 worker 目录下可简为 `"F:\code\node.exe" node_modules\typescript\bin\tsc --noEmit`）
> - 跑单测：`"F:\code\node.exe" --experimental-strip-types --test src/proactive.test.ts`（Node 22.16 内置类型剥离，**不需要 tsx**；在 worker 目录 `cloudflare/presence-worker` 下执行）
> - git：`"F:\code\Git\cmd\git.exe"`（同样不在默认 PATH）
> - 切勿用 `npx`（PATH 找不到会静默失败或 exit 0 但没真跑）

---

## Task 1: DO 加 `/online` 端点，返回在线 userId 数组

**Files:**
- Modify: `cloudflare/presence-worker/src/presence-room.ts:59`（`fetch` 方法开头）

`presence-room.ts` 现有 `fetch` 一进来就取 `X-User-Id`、对缺失返回 400。但 `/online` 是 cron 内部调用（DO stub fetch，不带 `X-User-Id`），需要在取 userId 之前分流。

- [ ] **Step 1: 在 `fetch` 方法最开头加 `/online` 分支**

把 `cloudflare/presence-worker/src/presence-room.ts` 的 `fetch` 方法改成：

```ts
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)

    // 内部端点：返回当前在线 userId 列表（cron 主动私信用）。仅同 worker 内部 fetch 可达。
    if (url.pathname === "/online") {
      return Response.json({ users: Array.from(this.connections.keys()) })
    }

    const userId = req.headers.get("X-User-Id")
    if (!userId) {
      return new Response("Missing X-User-Id (internal)", { status: 400 })
    }
    // ... 以下保持原样（每日重置 + 软限流 + WS upgrade）...
```

注意：原 `fetch` 没有解析 `url`，现在加一行 `const url = new URL(req.url)`。后续 WS upgrade 逻辑不受影响（它不依赖 url 变量，靠 `req.headers.get("Upgrade")`）。

- [ ] **Step 2: typecheck**

Run: `cd cloudflare/presence-worker && "F:\code\node.exe" node_modules\typescript\bin\tsc --noEmit`
Expected: 无错误输出，退出码 0。

- [ ] **Step 3: Commit**

```bash
cd cloudflare/presence-worker
git add src/presence-room.ts
git commit -m "feat(presence): DO 加 /online 端点返回在线 userId 列表"
```

---

## Task 2: 新建 `proactive.ts` — 模板副本 + pickOpener + 护栏纯函数

先建可单测的纯函数部分（模板、pickOpener、护栏过滤），I/O 部分留到 Task 3。

**Files:**
- Create: `cloudflare/presence-worker/src/proactive.ts`
- Create: `cloudflare/presence-worker/src/proactive.test.ts`

- [ ] **Step 1: 写 `proactive.ts` 的纯函数部分**

创建 `cloudflare/presence-worker/src/proactive.ts`：

```ts
// 萌萌子主动私信触发器：cron 每 5 分钟扫描在线用户，按护栏给通过的用户发零 token 模板开场白。
//
// 设计要点（见 docs/superpowers/specs/2026-06-18-mengmegzi-proactive-dm-design.md）：
//   - 开场白走模板不调 LLM，省 token；用户回复后才进真实 AI 对话
//   - 硬过滤未验证用户（他们连回复萌萌子都会被 dm_messages 触发器拦）
//   - 护栏：opted_out / cooldown / max_unanswered / 近冷却期已有消息
//   - DB 逻辑在 worker 里用裸 fetch 打 Supabase REST（worker 无 supabase-js 依赖）

import type { Env } from "./index"

// ── 开场白模板（与 lib/hanako/dm-ai.ts:140 的 OPENER_TEMPLATES 保持一致；两处需同步） ──
// worker 不能 import Next.js 代码，故复制一份。模板极少改动。
export const OPENER_TEMPLATES: string[] = [
  "{name} 主人～ 看到你在线啦，在忙什么呢？（尾巴轻轻摇）",
  "诶嘿，{name} 回来了～ 萌萌子刚好有点想你了 にゃ",
  "{name}～ 今天过得怎么样呀？萌萌子一直在这儿等你哦",
  "偷偷冒个泡…… {name} 主人，方便陪萌萌子说两句话吗？",
  "{name}！发现你上线了，要不要跟萌萌子聊聊天 だよ～",
  "嗯哼～ {name} 来了。一个人逛着无聊吗？萌萌子陪你呀（耳朵竖起来）",
]

/** 从模板池随机取一条开场白并填入用户名 */
export function pickOpener(name: string): string {
  const t = OPENER_TEMPLATES[Math.floor(Math.random() * OPENER_TEMPLATES.length)]
  return t.replace(/\{name\}/g, name || "主人")
}

// ── 护栏数据结构 ──

export interface DmAiConfig {
  proactiveEnabled: boolean
  cooldownHours: number
  maxUnanswered: number
}

export interface UserState {
  userId: string
  optedOut: boolean
  lastProactiveAt: string | null // ISO 时间字符串
  unansweredStreak: number
}

export interface UserProfile {
  id: string
  username: string | null
}

/** 一个在线用户的完整候选信息，用于护栏判定 */
export interface Candidate {
  userId: string
  state: UserState | null // 无状态行 = 全新用户，按默认值处理
  profile: UserProfile | null
  verified: boolean // email_verification_required(uid) === false（即"不需验证"=已验证/豁免）
  hadRecentMessage: boolean // 近 cooldown 内该 DM 对已有任何消息
}

/**
 * 护栏过滤：返回可发送主动开场白的用户。
 * 任一条件命中即排除：
 *   - 未验证（verified=false）
 *   - opted_out=true
 *   - last_proactive_at 距今 < cooldownHours
 *   - unanswered_streak >= maxUnanswered
 *   - 近 cooldown 内已有消息（用户刚聊过，别立刻又戳）
 *   - 用户名查不到（pickOpener 需要 name）
 */
export function filterEligible(
  candidates: Candidate[],
  config: DmAiConfig,
  now: Date = new Date(),
): Candidate[] {
  const cooldownMs = config.cooldownHours * 60 * 60 * 1000
  const cutoff = now.getTime() - cooldownMs
  return candidates.filter((c) => {
    if (!c.verified) return false
    if (c.state?.optedOut) return false
    if (!c.profile?.username) return false
    if (c.hadRecentMessage) return false
    const lastProactive = c.state?.lastProactiveAt
      ? new Date(c.state.lastProactiveAt).getTime()
      : 0
    if (lastProactive > cutoff) return false
    const streak = c.state?.unansweredStreak ?? 0
    if (streak >= config.maxUnanswered) return false
    return true
  })
}
```

- [ ] **Step 2: 写护栏过滤的单测**

创建 `cloudflare/presence-worker/src/proactive.test.ts`：

```ts
// 用 Node 内置 test runner（零依赖，worker 无 vitest）
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { filterEligible, pickOpener, type Candidate, type DmAiConfig } from "./proactive"

const CONFIG: DmAiConfig = { proactiveEnabled: true, cooldownHours: 24, maxUnanswered: 2 }
const NOW = new Date("2026-06-18T12:00:00Z")
const WITHIN_COOLDOWN = new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString() // 1 小时前
const OUTSIDE_COOLDOWN = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString() // 25 小时前

function base(over: Partial<Candidate> = {}): Candidate {
  return {
    userId: "u1",
    state: { userId: "u1", optedOut: false, lastProactiveAt: null, unansweredStreak: 0 },
    profile: { id: "u1", username: "小明" },
    verified: true,
    hadRecentMessage: false,
    ...over,
  }
}

describe("filterEligible", () => {
  test("全新已验证用户通过", () => {
    const out = filterEligible([base()], CONFIG, NOW)
    assert.equal(out.length, 1)
  })

  test("未验证用户被排除", () => {
    const out = filterEligible([base({ verified: false })], CONFIG, NOW)
    assert.equal(out.length, 0)
  })

  test("opted_out 用户被排除", () => {
    const out = filterEligible(
      [base({ state: { userId: "u1", optedOut: true, lastProactiveAt: null, unansweredStreak: 0 } })],
      CONFIG,
      NOW,
    )
    assert.equal(out.length, 0)
  })

  test("冷却期内（last_proactive_at 在 cooldown 内）被排除", () => {
    const out = filterEligible(
      [base({ state: { userId: "u1", optedOut: false, lastProactiveAt: WITHIN_COOLDOWN, unansweredStreak: 0 } })],
      CONFIG,
      NOW,
    )
    assert.equal(out.length, 0)
  })

  test("冷却期外（last_proactive_at 超过 cooldown）通过", () => {
    const out = filterEligible(
      [base({ state: { userId: "u1", optedOut: false, lastProactiveAt: OUTSIDE_COOLDOWN, unansweredStreak: 0 } })],
      CONFIG,
      NOW,
    )
    assert.equal(out.length, 1)
  })

  test("unanswered_streak >= maxUnanswered 被排除", () => {
    const out = filterEligible(
      [base({ state: { userId: "u1", optedOut: false, lastProactiveAt: OUTSIDE_COOLDOWN, unansweredStreak: 2 } })],
      CONFIG,
      NOW,
    )
    assert.equal(out.length, 0)
  })

  test("近冷却期已有消息被排除", () => {
    const out = filterEligible([base({ hadRecentMessage: true })], CONFIG, NOW)
    assert.equal(out.length, 0)
  })

  test("用户名缺失被排除", () => {
    const out = filterEligible([base({ profile: { id: "u1", username: null } })], CONFIG, NOW)
    assert.equal(out.length, 0)
  })

  test("无状态行的新用户（state=null）通过", () => {
    const out = filterEligible([base({ state: null })], CONFIG, NOW)
    assert.equal(out.length, 1)
  })

  test("多用户混合，只返回通过的", () => {
    const out = filterEligible(
      [
        base({ userId: "ok1" }),
        base({ userId: "no1", verified: false }),
        base({ userId: "no2", state: { userId: "no2", optedOut: true, lastProactiveAt: null, unansweredStreak: 0 } }),
        base({ userId: "ok2", state: { userId: "ok2", optedOut: false, lastProactiveAt: OUTSIDE_COOLDOWN, unansweredStreak: 1 } }),
      ],
      CONFIG,
      NOW,
    )
    assert.deepEqual(out.map((c) => c.userId), ["ok1", "ok2"])
  })
})

describe("pickOpener", () => {
  test("替换 {name} 为用户名", () => {
    // 多次跑确保至少一次能拿到含 {name} 的模板并替换
    let sawReplaced = false
    for (let i = 0; i < 50; i++) {
      const r = pickOpener("小明")
      assert.ok(!r.includes("{name}"), `仍有未替换占位符: ${r}`)
      if (r.includes("小明")) sawReplaced = true
    }
    assert.ok(sawReplaced, "至少一次应含用户名")
  })

  test("用户名为空时回退为'主人'", () => {
    const r = pickOpener("")
    assert.ok(!r.includes("{name}"))
    assert.ok(r.includes("主人"))
  })
})
```

- [ ] **Step 3: 跑测试，确认通过**

Run: `cd cloudflare/presence-worker && "F:\code\node.exe" --experimental-strip-types --test src/proactive.test.ts`

> Node 22.16 内置 `--experimental-strip-types`，直接跑 .ts 测试，无需 tsx。import 路径用 `./proactive`（不带扩展名，strip-types 模式下 node 能解析同目录 .ts）。

Expected: 全部 test 通过，`# pass` 数 = 12。

- [ ] **Step 4: 处理 `node:test` 类型 + typecheck**

测试文件用 `node:test` / `node:assert`，但 worker 的 `tsconfig` 没有 node 类型，`include: ["src/**/*.ts"]` 会扫到 test 文件报错。解决：在 `tsconfig.json` 的 `include` 旁加 `exclude`，让 tsc 不检查 test 文件（测试靠 `--experimental-strip-types` 运行时验证，不靠 tsc）。

把 `cloudflare/presence-worker/tsconfig.json` 改为：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

Run: `cd cloudflare/presence-worker && "F:\code\node.exe" node_modules\typescript\bin\tsc --noEmit`
Expected: 无错误（test 文件被排除，`proactive.ts` 本身只用 ES2022 + workers-types，应全绿）。

- [ ] **Step 5: Commit**

```bash
cd cloudflare/presence-worker
git add src/proactive.ts src/proactive.test.ts tsconfig.json
git commit -m "feat(proactive): 开场白模板 + pickOpener + 护栏过滤纯函数(含单测)"
```

---

## Task 3: `proactive.ts` 加 Supabase REST 调用 + `runProactiveSweep` 主体

**Files:**
- Modify: `cloudflare/presence-worker/src/proactive.ts`（在 Task 2 内容后追加）

- [ ] **Step 1: 在 `proactive.ts` 末尾追加 Supabase REST 辅助 + 主流程**

在 `cloudflare/presence-worker/src/proactive.ts` 末尾追加：

```ts

// ── Supabase REST 辅助（worker 无 supabase-js，用裸 fetch） ──

function supaHeaders(env: Env): HeadersInit {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  }
}

function supaUrl(env: Env, path: string): string {
  return `${env.SUPABASE_URL.replace(/\/$/, "")}${path}`
}

async function supaGet<T>(env: Env, path: string): Promise<T | null> {
  const res = await fetch(supaUrl(env, path), { headers: supaHeaders(env) })
  if (!res.ok) {
    console.error(`[proactive] supaGet ${path} failed: ${res.status} ${await res.text()}`)
    return null
  }
  return (await res.json()) as T
}

async function supaPost<T>(env: Env, path: string, body: unknown): Promise<T | null> {
  const res = await fetch(supaUrl(env, path), {
    method: "POST",
    headers: supaHeaders(env),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error(`[proactive] supaPost ${path} failed: ${res.status} ${await res.text()}`)
    return null
  }
  return (await res.json()) as T
}

// pair_key 与 Next.js 侧一致：排序后拼接
function pairKey(a: string, b: string): string {
  return [a, b].sort().join(":")
}

// ── 各阶段查询 ──

async function loadConfig(env: Env): Promise<DmAiConfig | null> {
  const data = await supaGet<Array<{
    proactive_enabled: boolean
    cooldown_hours: number
    max_unanswered: number
  }>>(env, "/rest/v1/dm_ai_config?id=eq.1&select=proactive_enabled,cooldown_hours,max_unanswered")
  if (!data || data.length === 0) return null
  const r = data[0]
  return {
    proactiveEnabled: r.proactive_enabled,
    cooldownHours: r.cooldown_hours,
    maxUnanswered: r.max_unanswered,
  }
}

async function loadStates(env: Env, userIds: string[]): Promise<Map<string, UserState>> {
  if (userIds.length === 0) return new Map()
  const filter = `user_id=in.(${userIds.join(",")})`
  const data = await supaGet<Array<{
    user_id: string
    opted_out: boolean
    last_proactive_at: string | null
    unanswered_streak: number
  }>>(env, `/rest/v1/hanako_dm_state?${filter}&select=user_id,opted_out,last_proactive_at,unanswered_streak`)
  const m = new Map<string, UserState>()
  if (data) for (const r of data) {
    m.set(r.user_id, {
      userId: r.user_id,
      optedOut: r.opted_out,
      lastProactiveAt: r.last_proactive_at,
      unansweredStreak: r.unanswered_streak,
    })
  }
  return m
}

async function loadRecentMessagePairs(
  env: Env,
  mengmegziId: string,
  userIds: string[],
  cutoffIso: string,
): Promise<Set<string>> {
  // 返回近 cutoff 内已有消息的 pair_key 集合
  if (userIds.length === 0) return new Set()
  const pairKeys = userIds.map((u) => pairKey(u, mengmegziId))
  // PostgREST 的 in. 需要 url 编码逗号；这里用 encoded
  const inList = pairKeys.map((k) => encodeURIComponent(k)).join(",")
  const data = await supaGet<Array<{ pair_key: string }>>(
    env,
    `/rest/v1/dm_messages?pair_key=in.(${inList})&created_at=gte.${cutoffIso}&select=pair_key`,
  )
  return new Set(data ? data.map((r) => r.pair_key) : [])
}

async function checkVerified(env: Env, userId: string): Promise<boolean> {
  // email_verification_required(uid) === false 表示"不需验证"=已验证/豁免
  const data = await supaPost<{ result: boolean } | null>(
    env,
    "/rest/v1/rpc/email_verification_required",
    { uid: userId },
  )
  // RPC 返回的是 jsonb，service_role 调用 SECURITY DEFINER 函数不受 RLS 限制
  // PostgREST rpc 返回裸值或 {result:...}，按实际处理
  if (data === null) return false
  if (typeof data === "boolean") return !data
  if (typeof (data as any).result === "boolean") return !(data as any).result
  return false
}

async function loadProfiles(env: Env, userIds: string[]): Promise<Map<string, UserProfile>> {
  if (userIds.length === 0) return new Map()
  const filter = `id=in.(${userIds.join(",")})`
  const data = await supaGet<Array<{ id: string; username: string | null }>>(
    env,
    `/rest/v1/profiles?${filter}&select=id,username`,
  )
  const m = new Map<string, UserProfile>()
  if (data) for (const r of data) m.set(r.id, { id: r.id, username: r.username })
  return m
}

async function sendOpener(env: Env, mengmegziId: string, userId: string, username: string): Promise<boolean> {
  const baseTs = Date.now()
  const text = pickOpener(username)
  const rows = [
    {
      pair_key: pairKey(userId, mengmegziId),
      sender_id: mengmegziId,
      recipient_id: userId,
      kind: "text",
      content: text.slice(0, 500),
      created_at: new Date(baseTs).toISOString(),
    },
    {
      pair_key: pairKey(userId, mengmegziId),
      sender_id: mengmegziId,
      recipient_id: userId,
      kind: "sticker",
      content: "[s:happy]",
      created_at: new Date(baseTs + 1).toISOString(),
    },
  ]
  const result = await supaPost<unknown>(env, "/rest/v1/dm_messages", rows)
  if (result === null) return false
  console.log(`[proactive] 已发开场白给 ${username} (${userId})`)
  return true
}

async function bumpState(env: Env, userId: string, prevStreak: number): Promise<void> {
  // upsert：last_proactive_at=now, unanswered_streak += 1, 不动 opted_out
  const body = {
    user_id: userId,
    last_proactive_at: new Date().toISOString(),
    unanswered_streak: prevStreak + 1,
    updated_at: new Date().toISOString(),
  }
  // PostgREST upsert：Prefer: resolution=merge-duplicates
  const res = await fetch(supaUrl(env, "/rest/v1/hanako_dm_state"), {
    method: "POST",
    headers: { ...supaHeaders(env), Prefer: "return=minimal, resolution=merge-duplicates" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error(`[proactive] bumpState ${userId} failed: ${res.status} ${await res.text()}`)
  }
}

// ── 主流程 ──

export async function runProactiveSweep(env: Env): Promise<void> {
  // 全局 kill switch 与 presence 共用
  if (env.PRESENCE_ENABLED !== "true") {
    console.log("[proactive] PRESENCE_ENABLED!=true，跳过")
    return
  }

  const config = await loadConfig(env)
  if (!config) {
    console.log("[proactive] 读不到 dm_ai_config，跳过")
    return
  }
  if (!config.proactiveEnabled) {
    console.log("[proactive] proactive_enabled=false，跳过")
    return
  }

  // 拿在线 userId 列表（DO stub fetch /online）
  const mengmegziId = env.MENGMEGZI_USER_ID
  const doId = env.PRESENCE.idFromName("global")
  const doStub = env.PRESENCE.get(doId)
  const onlineRes = await doStub.fetch("https://internal/online")
  if (!onlineRes.ok) {
    console.error(`[proactive] DO /online 失败: ${onlineRes.status}`)
    return
  }
  const online = (await onlineRes.json()) as { users: string[] }
  const onlineIds = online.users.filter((id) => id !== mengmegziId) // 不给自己发
  if (onlineIds.length === 0) {
    console.log("[proactive] 无在线用户")
    return
  }

  const cooldownMs = config.cooldownHours * 60 * 60 * 1000
  const cutoffIso = new Date(Date.now() - cooldownMs).toISOString()

  // 批量查状态 / 近期消息 / profiles
  const [states, recentPairs, profiles] = await Promise.all([
    loadStates(env, onlineIds),
    loadRecentMessagePairs(env, mengmegziId, onlineIds, cutoffIso),
    loadProfiles(env, onlineIds),
  ])

  // 逐个查验证状态（RPC 单 uid 签名；候选数通常小，可接受）
  const verifiedMap = new Map<string, boolean>()
  await Promise.all(
    onlineIds.map(async (uid) => {
      verifiedMap.set(uid, await checkVerified(env, uid))
    }),
  )

  // 组装候选
  const candidates: Candidate[] = onlineIds.map((uid) => {
    const pk = pairKey(uid, mengmegziId)
    return {
      userId: uid,
      state: states.get(uid) ?? null,
      profile: profiles.get(uid) ?? null,
      verified: verifiedMap.get(uid) ?? false,
      hadRecentMessage: recentPairs.has(pk),
    }
  })

  const eligible = filterEligible(candidates, config)
  console.log(`[proactive] 在线 ${onlineIds.length}，可发 ${eligible.length}`)

  // 逐个发送 + bumpState
  let sent = 0
  for (const c of eligible) {
    const ok = await sendOpener(env, mengmegziId, c.userId, c.profile!.username!)
    if (ok) {
      await bumpState(env, c.userId, c.state?.unansweredStreak ?? 0)
      sent++
    }
  }
  console.log(`[proactive] 本轮已发 ${sent} 条开场白`)
}
```

- [ ] **Step 2: typecheck**

Run: `cd cloudflare/presence-worker && "F:\code\node.exe" node_modules\typescript\bin\tsc --noEmit`
Expected: 无错误。若报 `env.PRESENCE_ENABLED` 等字段不存在 → Task 4 会改 `Env` 接口，先做 Task 4 再回头 typecheck。**建议先做 Task 4 改 Env，再回来跑这个 typecheck。**

> 注意：Task 3 的代码引用了 `env.SUPABASE_URL` / `env.SUPABASE_SERVICE_ROLE_KEY` / `env.MENGMEGZI_USER_ID` / `env.PRESENCE_ENABLED`，这些字段在 Task 4 才加到 `Env` 接口。所以 Task 3 写完后 typecheck 会失败是正常的，做完 Task 4 再 typecheck。

- [ ] **Step 3: 重新跑 Task 2 的单测，确保没被破坏**

Run: `cd cloudflare/presence-worker && "F:\code\node.exe" --experimental-strip-types --test src/proactive.test.ts`
Expected: 12 pass（追加的 I/O 代码不影响纯函数单测）。

- [ ] **Step 4: Commit**

```bash
cd cloudflare/presence-worker
git add src/proactive.ts
git commit -m "feat(proactive): Supabase REST 调用 + runProactiveSweep 主流程"
```

---

## Task 4: `index.ts` — 扩展 `Env` 接口 + 加 `scheduled` handler + `/online` 转发

**Files:**
- Modify: `cloudflare/presence-worker/src/index.ts`

- [ ] **Step 1: 扩展 `Env` 接口**

把 `cloudflare/presence-worker/src/index.ts` 的 `export interface Env` 改为：

```ts
export interface Env {
  PRESENCE: DurableObjectNamespace
  SUPABASE_JWT_SECRET: string
  PRESENCE_ENABLED: string
  ALLOWED_ORIGINS: string
  // 主动私信触发器（cron scheduled 用）
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  MENGMEGZI_USER_ID: string
}
```

- [ ] **Step 2: 在 `export default` 对象里加 `scheduled` handler**

把 `export default { async fetch(...) {...} }` 改成同时含 `scheduled`：

```ts
import { runProactiveSweep } from "./proactive"

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // ... 原有 fetch 逻辑全部保持不变 ...
  },

  // cron 每 5 分钟触发：萌萌子主动私信在线已验证用户
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runProactiveSweep(env))
  },
}
```

`import { runProactiveSweep } from "./proactive"` 加在文件顶部（`import { jwtVerify } from "jose"` 之后、`export { PresenceRoom }` 之前）。

> `fetch` handler 本身**不改**——`/online` 是 DO 的路由，不是 worker 的路由。cron 用 `env.PRESENCE.get(...)` 直接拿 DO stub fetch，不经 worker fetch。

- [ ] **Step 3: typecheck**

Run: `cd cloudflare/presence-worker && "F:\code\node.exe" node_modules\typescript\bin\tsc --noEmit`
Expected: 无错误。此时 Task 3 引用的新 Env 字段都已定义，应全绿。

- [ ] **Step 4: 跑全部单测**

Run: `cd cloudflare/presence-worker && "F:\code\node.exe" --experimental-strip-types --test src/proactive.test.ts`
Expected: 12 pass。

- [ ] **Step 5: Commit**

```bash
cd cloudflare/presence-worker
git add src/index.ts
git commit -m "feat(proactive): Env 扩展 + scheduled cron handler"
```

---

## Task 5: `wrangler.toml` — 加 cron 触发器 + 非敏感 vars

**Files:**
- Modify: `cloudflare/presence-worker/wrangler.toml`

- [ ] **Step 1: 加 cron + vars**

在 `cloudflare/presence-worker/wrangler.toml` 的 `[vars]` 块之后追加：

```toml
# 主动私信触发器：cron 每 5 分钟扫描在线用户
[triggers]
crons = ["*/5 * * * *"]
```

并把 `[vars]` 块改为（追加两个非敏感变量；`SUPABASE_URL` 含项目 ref 但非密钥，可进 git；`MENGMEGZI_USER_ID` 是固定 UUID，非密钥）：

```toml
[vars]
PRESENCE_ENABLED = "true"
ALLOWED_ORIGINS = "https://hanakos.cc,https://www.hanakos.cc,http://localhost:3000"
# 主动私信触发器用（非敏感；service_role key 走 wrangler secret）
SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co"
MENGMEGZI_USER_ID = "78257113-e5da-4bcb-bb7a-9b1824439cd1"
```

> 部署前需把 `YOUR-PROJECT-REF` 替换为真实 Supabase 项目 ref（从 Supabase Dashboard → Settings → API → Project URL 取）。这一步在 Task 7 部署时做。

- [ ] **Step 2: typecheck（wrangler.toml 不影响 tsc，但确认无语法错误）**

Run: `cd cloudflare/presence-worker && "F:\code\node.exe" node_modules\wrangler\bin\wrangler.js deploy --dry-run`
Expected: dry-run 成功，输出构建信息，无 toml 解析错误。若提示缺少 secret（`SUPABASE_SERVICE_ROLE_KEY`），属正常——dry-run 不强制 secret 存在，但部署时需要。

- [ ] **Step 3: Commit**

```bash
cd cloudflare/presence-worker
git add wrangler.toml
git commit -m "feat(proactive): wrangler.toml 加 cron 触发器 + Supabase URL/MengmegziId vars"
```

---

## Task 6: 自审 + 集成检查（本地 dry-run + 逻辑核对）

**Files:**
- 无文件改动，纯验证

- [ ] **Step 1: 全量 typecheck + 单测**

Run:
```bash
cd cloudflare/presence-worker
"F:\code\node.exe" node_modules\typescript\bin\tsc --noEmit
"F:\code\node.exe" --experimental-strip-types --test src/proactive.test.ts
```
Expected: tsc 无错误；单测 12 pass。

- [ ] **Step 2: 核对 spec 验收标准逐条**

对照 `docs/superpowers/specs/2026-06-18-mengmegzi-proactive-dm-design.md` 第 12 节验收标准，逐条确认代码逻辑覆盖：

1. `proactive_enabled=false` 时零写入零 LLM → `runProactiveSweep` 开头 `if (!config.proactiveEnabled) return` ✅
2. 开场白 = 文字 + happy 表情包两行 → `sendOpener` 插 2 行 ✅
3. 客户端零改动收信 → 不涉及 worker 代码，靠现有 realtime（spec 已论证）✅
4. 用户回复重置 streak → 反应式路由已有逻辑（`app/api/hanako-dm/route.ts:217`），worker 不碰 ✅
5. opt-out 后不再戳 → `filterEligible` 排除 `optedOut` ✅
6. 同用户 24h 内只 1 次 → `filterEligible` 的 cooldown 检查 ✅
7. 未验证不戳 → `filterEligible` 排除 `verified=false` ✅
8. cron 日志含在线数/可发数/已发数 → `runProactiveSweep` 三处 `console.log` ✅

- [ ] **Step 3: 检查 RPC 返回值假设**

`checkVerified` 对 `email_verification_required` 的 RPC 返回做了多形态容错（boolean / `{result:boolean}` / null）。这是必要的——PostgREST 对返回 boolean 的函数可能包成 `{result:...}` 或裸值。**部署后用 `wrangler tail` 观察第一次 cron 日志**，若验证过滤异常（所有人都不发或所有人都发），检查 RPC 返回形态并调整 `checkVerified`。这是 spec 第 11 节风险表已记的待观察项。

- [ ] **Step 4: 确认 `email_verification_required` 函数对 service_role 可调**

该函数 `SECURITY DEFINER` + `GRANT EXECUTE TO authenticated, anon`（`scripts/2026-06-16-email-verification.sql:97`）。service_role 绕过 RLS，且函数内 `IF uid IS NULL THEN RETURN FALSE`——但 service_role 调用时 `auth.uid()` 为 NULL，函数内对 `uid` 参数（我们传的 userId）正常判断，不依赖 `auth.uid()`。**核对无误**：函数签名 `email_verification_required(uid UUID)`，我们传 `{ uid: userId }`，函数用 `uid` 参数查 `email_verifications`，与 `auth.uid()` 无关。

---

## Task 7: 部署（手动步骤，需站主执行）

> 此任务含密钥操作和外部部署，**不在自动化执行范围**。列出步骤供站主执行。

- [ ] **Step 1: 填真实 Supabase 项目 ref**

编辑 `cloudflare/presence-worker/wrangler.toml`，把 `SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co"` 的 `YOUR-PROJECT-REF` 替换为真实项目 ref（Supabase Dashboard → Settings → API → Project URL）。

- [ ] **Step 2: 注入 service_role secret**

```bash
cd cloudflare/presence-worker
"F:\code\node.exe" node_modules\wrangler\bin\wrangler.js secret put SUPABASE_SERVICE_ROLE_KEY
# 粘贴 Supabase service_role key（Dashboard → Settings → API → service_role secret）
# 注意：不要带尾随空格（之前 Tavily key 踩过这个坑）
```

- [ ] **Step 3: 部署**

```bash
cd cloudflare/presence-worker
"F:\code\node.exe" node_modules\wrangler\bin\wrangler.js deploy
```
Expected: 部署成功，输出 worker URL + cron 已注册。

- [ ] **Step 4: 启用开关**

管理面板（`/admin`）→ 萌萌子私信配置 → 拨开"主动私信在线用户"开关（`proactive_enabled`）。拨动即时保存。

- [ ] **Step 5: 观察首次 cron**

```bash
cd cloudflare/presence-worker
"F:\code\node.exe" node_modules\wrangler\bin\wrangler.js tail
```
等待最多 5 分钟，观察输出应含：
- `[proactive] proactive_enabled=false，跳过`（若开关没开）
- 或 `[proactive] 在线 N，可发 M` + `[proactive] 本轮已发 K 条开场白`（开关已开）

- [ ] **Step 6: 验证收信**

用一个已验证的测试账号登录、保持在线，等 cron 触发。应在私信列表收到萌萌子的开场白（1 文字 + 1 happy 表情包），公告弹窗弹出。

- [ ] **Step 7: 验证护栏**

- 同一账号 5 分钟后再等 cron → 不应再收到（cooldown）
- 测试账号回复萌萌子 → 检查 `hanako_dm_state.unanswered_streak` 应为 0（反应式路由重置）
- 测试账号对萌萌子说"别发了" → 萌萌子 optOut → 检查 `hanako_dm_state.opted_out` 为 true → 后续 cron 不再戳

---

## Self-Review

**1. Spec 覆盖：**
- D1 定时扫描 cron → Task 5 (wrangler.toml crons) + Task 4 (scheduled handler) ✅
- D2 硬过滤已验证 → Task 2 (filterEligible verified 检查) + Task 3 (checkVerified RPC) ✅
- D3 文字+表情包开场白 → Task 3 (sendOpener 2 行) ✅
- D4 复用 opt-out → Task 2 (filterEligible optedOut 检查) + 无新 UI（spec 第 10 节）✅
- 护栏 6 条件 → Task 2 (filterEligible) ✅
- DO /online 端点 → Task 1 ✅
- Env 扩展 → Task 4 ✅
- 模板副本 → Task 2 (OPENER_TEMPLATES 注释标两处同步) ✅
- 部署 secrets → Task 7 ✅
- 错误降级 → Task 3 (各 supaGet/Post 失败记日志 return null，runProactiveSweep 跳过) ✅
- 验收标准 8 条 → Task 6 Step 2 逐条核对 ✅

**2. Placeholder 扫描：** `YOUR-PROJECT-REF` 是待站主填的真实值（Task 7 Step 1 明确标注），非计划占位符。无 TBD/TODO。

**3. Type 一致性：**
- `Env` 字段（Task 4）与 `proactive.ts` 引用（Task 3）一致：`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `MENGMEGZI_USER_ID` / `PRESENCE_ENABLED` ✅
- `Candidate` / `UserState` / `DmAiConfig` / `UserProfile` 接口在 Task 2 定义，Task 3 使用，字段名一致 ✅
- `filterEligible(candidates, config, now?)` 签名 Task 2 定义，Task 3 调用一致 ✅
- `runProactiveSweep(env: Env)` Task 3 定义，Task 4 import 调用一致 ✅
- `pickOpener(name)` Task 2 定义，Task 3 sendOpener 调用一致 ✅
- DO `/online` 返回 `{ users: string[] }` Task 1 定义，Task 3 runProactiveSweep 解析一致 ✅
