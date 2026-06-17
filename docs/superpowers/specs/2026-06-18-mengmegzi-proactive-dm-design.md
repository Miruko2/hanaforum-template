# 萌萌子主动私信在线用户 — 设计文档

> 日期：2026-06-18
> 状态：设计待审
> 范围：给 Cloudflare presence worker 加一个定时扫描触发器，让萌萌子按护栏规则主动给在线用户发零 token 模板开场白，用户回复后才进入真实 AI 对话。

## 1. 目标与背景

萌萌子（DM AI 角色，`MENGMEGZI_USER_ID`）目前只在**用户先私信她**时才回复（反应式 `/api/hanako-dm`）。本次让她能**主动**找在线用户搭话，作为冷启动社交的破冰。

核心诉求（来自站主）：
1. **省 token**：开场白用固定模板，**不调 LLM**。用户回复后才走真实 AI 对话。
2. 萌萌子**优先找已通过邮箱验证的账号**。

### 已就位的"地基"（第二批之前铺好的，本次复用）

| 零件 | 位置 | 现状 |
|---|---|---|
| CF presence worker + 全局 DO | `cloudflare/presence-worker/src/{index.ts,presence-room.ts}` | 已部署。DO 内存持有权威在线 userId 集合（`connections: Map<userId, Set<WebSocket>>`）。仅处理 WS，无 `scheduled()`，无读在线列表的 HTTP 端点。 |
| 管理面板开关 `dm_ai_config.proactive_enabled` | `app/admin/page.tsx:1623`、`app/api/admin/dm-ai-config/route.ts:120` | 已存库、即时保存，但**无任何代码读它触发**。UI 自己标注"需第2批+worker才生效"。 |
| 护栏表 `hanako_dm_state` | `scripts/2026-06-17-hanako-dm-ai.sql:28` | 有 `opted_out`/`last_proactive_at`/`unanswered_streak`。`last_proactive_at` **从未被写**；`unanswered_streak` 在反应式路由用户回复时重置为 0（`app/api/hanako-dm/route.ts:217`）。RLS 锁 service_role。 |
| 配置 `cooldown_hours`(默认 24)/`max_unanswered`(默认 2) | 同上 SQL | 已存库，`loadDmAiConfig()` 已加载但未用于触发。 |
| 零 token 开场白模板 `OPENER_TEMPLATES` + `pickOpener(name)` | `lib/hanako/dm-ai.ts:140` | 已写好，**0 调用方**。 |
| 客户端收到开场白后的展示 | `components/floating-chat.tsx:412`（realtime `dm_incoming`）、`announcement-popup.tsx:281` | **零改动**——开场白就是一条普通 `dm_messages` 行，现有 realtime 自动收、自动弹通知。 |
| 邮箱验证判定函数 `email_verification_required(uid)` | `scripts/2026-06-16-email-verification.sql:60` | `SECURITY DEFINER` + `STABLE`，可 RPC 调用。验证关闭时对所有人返回 FALSE（不误伤）；开启时只有已验证/豁免用户返回 FALSE。 |

### 缺的（本次要建）

唯一的触发回路：当 `proactive_enabled=true` 时，定时枚举在线用户、跑护栏、给通过的用户插一条模板开场白行。

## 2. 设计决策（已与站主确认）

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| D1 | 触发时机 | **定时扫描**（cron 每 5 分钟） | 与 presence 事件解耦、最易推理；CF Cron Triggers 免费；5 分钟延迟对破冰场景无感。 |
| D2 | 候选池过滤 | **硬过滤已验证用户** | 未验证用户连回复萌萌子都会被 `dm_messages` 的 `trg_require_verified_dm_messages` 触发器拦住（抛 `EMAIL_UNVERIFIED`）。给不能回的人发主动私信 = 让对方撞墙。所以不是"优先"而是"只给能回的"。 |
| D3 | 开场白形态 | **文字 + 表情包**（两行 `dm_messages`） | 贴合萌萌子爱发表情包的人设；仍是零 token、零 LLM。文字走 `pickOpener(name)`，表情包固定 `[s:happy]`。 |
| D4 | 退订方式 | **复用现有对话内 opt-out**，不加显式开关 | 嫌烦的用户说"别发了"→ 反应式路由 `parseReplies` 检测 `optOut=true` → 写 `opted_out=true` → worker 跳过。省掉后续被戳时礼貌回一句的那轮 LLM。不回的用户由 `max_unanswered` 护栏自动兜住。零额外 UI、零额外代码。 |

## 3. 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Worker (presence-worker)                        │
│                                                              │
│  scheduled(event, env, ctx)        ← 新增，cron 每 5 分钟   │
│    1. 读 dm_ai_config.proactive_enabled / cooldown_hours   │
│       / max_unanswered（裸 fetch Supabase REST, service_role）│
│    2. 若 !proactive_enabled → 直接 return                   │
│    3. 问 DO 拿在线 userId 列表（cron 直接用 DO stub 调，不走 HTTP）│
│    4. 批量查 hanako_dm_state（这些 userId 的状态行）        │
│    5. 批量查 dm_messages（这些 userId 近 cooldown 内有无消息）│
│    6. 批量 RPC email_verification_required（逐个，或合并）  │
│    7. 内存跑护栏，筛出可发用户                              │
│    8. 对每个可发用户：                                      │
│         - pickOpener(name)（worker 内复制一份模板，或 HTTP 拉用户名）│
│         - 插 2 行 dm_messages（文字 + [s:happy]）           │
│         - upsert hanako_dm_state：last_proactive_at=now,    │
│           unanswered_streak += 1                            │
│    9. done（CPU 时间几 ms~几十 ms，I/O 等待不计费）          │
│                                                              │
│  fetch(req, env)               ← 已有：WS + /health         │
│    新增 /presence 端点 → DO 返回在线 userId 数组            │
└─────────────────────────────────────────────────────────────┘
        │ (1) cron 触发                (3) DO 内存读
        ▼                               │
┌──────────────────────┐    ┌───────────┴──────────┐
│ Supabase REST        │    │ PresenceRoom DO       │
│ (service_role)       │    │ connections: Map      │
│ - dm_ai_config       │    │ 新增 getOnlineIds()   │
│ - hanako_dm_state    │    └───────────────────────┘
│ - dm_messages        │
│ - email_verification │
│   _required(uid) RPC │
│ - profiles (用户名)  │
└──────────────────────┘
        │ (8) 插入开场白行 + upsert 状态
        ▼
┌──────────────────────────────────────────────────────┐
│ dm_messages（萌萌子 → 用户，2 行：文字 + 表情包）     │
│   ↓ Supabase Realtime INSERT                         │
│ 客户端 floating-chat dm_incoming 频道自动收 + 弹通知  │
└──────────────────────────────────────────────────────┘
```

### 为什么把 DB 逻辑放在 worker 里（而不是回调 Next.js）

1. **自包含**：触发器与 presence 数据同处一个部署单元，无需跨服务鉴权。
2. **少一跳**：worker→Next.js 的 HTTP 回调会多一次冷启动风险 + 鉴权签名设计。
3. **省 Next.js 函数调用**：Vercel serverless 按调用计费，cron 直接在 worker 跑不消耗 Vercel 额度。
4. **代价**：worker 要用裸 `fetch` 打 Supabase REST（worker 无 supabase-js 依赖，只有 jose）。可接受——REST API 调用很简单。

### 为什么不新建一个独立 worker

presence worker 已经持有在线 userId 集合（DO 内存），这是触发器唯一的数据源。新建独立 worker 还得跨 worker 调 DO，徒增复杂度。同一个 worker 加 `scheduled()` 即可。

## 4. 护栏规则（候选过滤）

对每个在线用户，**任一条件命中即跳过**：

| 条件 | 来源 | 含义 |
|---|---|---|
| `opted_out = true` | `hanako_dm_state` | 用户明说别发了，永久排除（直到下次用户主动私信重置） |
| `last_proactive_at` 距今 < `cooldown_hours` | `hanako_dm_state` + `dm_ai_config` | 同一用户冷却期内不重复戳 |
| `unanswered_streak >= max_unanswered` | `hanako_dm_state` + `dm_ai_config` | 连续 N 次主动私信没回，别再戳了 |
| 该 DM 对在 `cooldown_hours` 内已有任何消息 | `dm_messages`（按 pair_key + created_at） | 用户刚回过/刚聊过，别立刻又戳 |
| `email_verification_required(uid) = TRUE` | RPC 函数 | 未验证用户不能回复萌萌子，不戳 |
| 用户名查不到（profile 缺失） | `profiles` | `pickOpener` 需要 name，没名字就跳过 |

**发送后**：upsert `hanako_dm_state`：
- `last_proactive_at = now()`
- `unanswered_streak = COALESCE(unanswered_streak, 0) + 1`
- `opted_out` 保持原值（不动）

**用户回复后**（已有逻辑，无需改）：反应式路由 `/api/hanako-dm` 在用户发消息触发回复时，会把 `unanswered_streak` 重置为 0（`route.ts:217-223`）。所以 streak 语义 = "连续未答的主动私信数"，自然成立。

## 5. 开场白内容

`pickOpener(name)` 已有 6 条模板（`lib/hanako/dm-ai.ts:140`），随机取一条并把 `{name}` 替换成用户名。本次发送时插入 **2 行**：

```
行1: { kind: "text",    content: pickOpener(name) }   // 例："诶嘿，小明回来了～ 萌萌子刚好有点想你了 にゃ"
行2: { kind: "sticker", content: "[s:happy]" }        // 固定 happy，开场喜庆
```

`created_at`：行1 = `now()`，行2 = `now() + 1ms`（与反应式路由同样的 1ms 增量 trick，保 realtime 排序稳定）。

> 模板/`pickOpener` 目前在 Next.js 侧（`lib/hanako/dm-ai.ts`）。worker 不能 import Next.js 代码。两个选择：(a) 在 worker 里**复制一份**模板数组 + pickOpener 函数（6 条字符串，复制成本低，但有两处要同步）；(b) 把模板抽到 worker 也能 import 的位置。**选 (a)**——6 条字符串的重复远比跨包共享的工程复杂度划算，且模板极少改动。文档里会标注"两处需同步"。

## 6. Worker 改动详图

### 6.1 `wrangler.toml` — 加 cron 触发器 + Supabase 配置

```toml
# 已有 vars 之后追加：
[triggers]
crons = ["*/5 * * * *"]   # 每 5 分钟

# 非敏感：Supabase 项目 URL（可进 git）
# 敏感：SUPABASE_SERVICE_ROLE_KEY 用 wrangler secret put 注入
```

新增需要的环境变量：
- `SUPABASE_URL`（非敏感，可进 `[vars]`）：如 `https://xxx.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`（**敏感**，`wrangler secret put`）：worker 用 service_role 调 REST/RPC
- `MENGMEGZI_USER_ID`（非敏感，可进 `[vars]`）：`78257113-...`，worker 插 dm_messages 时当 sender_id

### 6.2 `src/index.ts` — 加 scheduled handler + /presence 端点

```ts
export interface Env {
  PRESENCE: DurableObjectNamespace
  SUPABASE_JWT_SECRET: string
  PRESENCE_ENABLED: string
  ALLOWED_ORIGINS: string
  // 新增
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  MENGMEGZI_USER_ID: string
}

export default {
  async fetch(req, env, ctx) { /* 已有 + 新增 /presence 路由 */ },
  // 新增
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runProactiveSweep(env))
  },
}
```

`fetch(req, env, ctx)` 已有：WS + `/health`。
`scheduled(event, env, ctx)` 新增：cron 入口，调 `runProactiveSweep(env)`。

cron 拿在线列表**不走 HTTP**——直接 `env.PRESENCE.get(env.PRESENCE.idFromName("global"))` 拿 DO stub，再 `stub.fetch("/online")` 触发 DO 的新路由。`/online` 端点仅内部调用 + 调试用，不对外暴露鉴权（DO 只能从同 worker 内部 fetch 到）。

### 6.3 `src/presence-room.ts` — DO 加 getOnlineIds

```ts
// 在 PresenceRoom 类里加一个普通 fetch 路由（已有 fetch 处理 WS upgrade）
// 新增：GET /online → 返回 { users: [...] }
async fetch(req) {
  // ... 已有 WS upgrade 逻辑 ...
  const url = new URL(req.url)
  if (url.pathname === "/online") {
    return Response.json({ users: Array.from(this.connections.keys()) })
  }
  // ... 原有 ...
}
```

### 6.4 `src/proactive.ts`（新文件）— 触发器主体

核心函数 `runProactiveSweep(env)`，步骤如第 3 节架构图。用裸 `fetch` 调 Supabase REST：

- `GET /rest/v1/dm_ai_config?id=eq.1&select=proactive_enabled,cooldown_hours,max_unanswered` — header `apikey` + `Authorization: Bearer <service_role>`
- `GET /rest/v1/hanako_dm_state?user_id=in.(...)&select=user_id,opted_out,last_proactive_at,unanswered_streak`
- `GET /rest/v1/dm_messages?pair_key=in.(...)&created_at=gte.<cooldownCutoff>&select=pair_key` — 判断近冷却期有无消息
- `POST /rest/v1/rpc/email_verification_required` body `{ uid }` — 逐个调（函数签名单 uid；候选通常很少，可接受）
- `GET /rest/v1/profiles?id=in.(...)&select=id,username` — 拿用户名给 pickOpener
- 插开场白：`POST /rest/v1/dm_messages` 批量 insert（文字行 + 表情包行）
- upsert 状态：`POST /rest/v1/hanako_dm_state`（upsert on `user_id`）

## 7. 数据流：一次完整扫描

1. **cron 触发** `scheduled()`，`ctx.waitUntil(runProactiveSweep(env))`
2. 读 `dm_ai_config` → 若 `proactive_enabled=false`，return（零成本）
3. `env.PRESENCE.get(idFromName("global"))` → DO 返回在线 userId 数组
4. 若在线列表为空，return
5. 批量查 `hanako_dm_state`（这些 userId）→ 内存 Map
6. 批量查 `dm_messages`（这些 pair_key，近 cooldown）→ 哪些对刚聊过
7. 逐个 RPC `email_verification_required(uid)` → 筛掉未验证
8. 查 `profiles` 拿用户名
9. 内存跑护栏，得可发列表
10. 对每个可发用户：
    - `pickOpener(name)` → 文字
    - `POST dm_messages`（2 行：文字 + `[s:happy]`，created_at 1ms 增量）
    - `POST hanako_dm_state` upsert（`last_proactive_at=now`, `unanswered_streak+=1`）
11. done

**成本**：1 次 config 读 + 1 次在线列表 + 2 次批量状态查 + N 次验证 RPC（N=在线数，通常 <50）+ 1 次 profiles + 2×可发数 写入。CF CPU 时间几 ms~几十 ms（I/O 等待不计费）。

## 8. 错误处理与降级

| 场景 | 处理 |
|---|---|
| `proactive_enabled=false` | 立即 return，零成本 |
| DO 拿在线列表失败 | 记日志，return（下个 cron 再试） |
| Supabase 任一查询失败 | 记日志，跳过本轮（不部分发送，避免状态不一致） |
| 某用户 insert 失败 | 跳过该用户，继续其他用户（不影响他人） |
| 某用户 state upsert 失败 | 记日志（insert 已成功，用户已收到消息；下轮 cooldown 会因 last_proactive_at 未更新而过早再发——可接受，护栏 max_unanswered 仍兜底） |
| worker secret 缺失 | scheduled 里 try/catch，记日志 return |
| 全局 kill：`PRESENCE_ENABLED != "true"` | scheduled 也应尊重此开关，开头检查 |

## 9. 部署步骤

1. **Supabase**：无需新表/函数/触发器（全部复用现有）。确认 `dm_ai_config` 行 id=1 存在（已有默认行）。
2. **CF worker secrets**：
   ```
   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   ```
   （`SUPABASE_URL` 和 `MENGMEGZI_USER_ID` 进 `[vars]`，非敏感）
3. **wrangler.toml**：加 `[triggers] crons` + 新 vars
4. **代码**：改 `src/index.ts`、`src/presence-room.ts`，新增 `src/proactive.ts`，复制 OPENER_TEMPLATES 到 worker
5. **`wrangler deploy`**
6. **启用**：管理面板拨 `proactive_enabled=true`（开关已存在，拨动即时保存）
7. **观察**：`wrangler tail` 看每次 cron 日志；Supabase 查 `dm_messages` 确认开场白插入

## 10. 不在本次范围

- 不改客户端（`floating-chat.tsx` / `announcement-popup.tsx`）：开场白就是普通 dm_messages，现有 realtime 自动收。
- 不改反应式路由 `/api/hanako-dm`：它的 `unanswered_streak=0` 重置逻辑已就位。
- 不加显式退订 UI：复用对话内 opt-out。
- 不新建独立 worker：复用 presence worker。
- 不引入 supabase-js 到 worker：用裸 fetch REST。
- 不做"上线即触发"的 Alarm 方案：定时扫描足够。

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 模板两处不同步（worker + Next.js） | 文档标注；模板极少改；可选：加单测比对两处数组相等（YAGNI，暂不做） |
| service_role key 进 worker，泄露风险 | 走 `wrangler secret`，不进 git；worker 代码不外泄 key |
| cron 与 DO hibernation 交互 | DO 的 `fetch` 即使 hibernated 也会唤醒；在线列表从 `connections` Map 读，hibernation 恢复时已重建（构造函数 `:46-56`） |
| 用户连续收到开场白烦扰 | `cooldown_hours=24`（默认）+ `max_unanswered=2` 双护栏；对话 opt-out 永久排除 |
| 未验证用户被误戳 | 硬过滤 `email_verification_required` RPC；验证关闭时该函数对所有人返回 FALSE，不影响 |
| 并发：多个 cron 实例同时跑 | CF cron 同一时刻只触发一次；DO 单实例串行；护栏基于 DB 状态，即使并发也由 `last_proactive_at` 去重 |

## 12. 验收标准

1. `proactive_enabled=false` 时，cron 触发但零写入、零 LLM 调用
2. `proactive_enabled=true` 且有在线已验证用户时，5 分钟内该用户收到 1 条文字 + 1 条 happy 表情包
3. 收到开场白的用户在 sidebar 出现萌萌子会话、有未读红点、公告弹窗弹出（现有行为，零改动验证）
4. 用户回复萌萌子 → `unanswered_streak` 重置为 0（现有逻辑）
5. 用户说"别发了" → 下次 cron 不再戳该用户（`opted_out=true`）
6. 同一用户 24 小时内只收 1 次主动私信（cooldown 护栏）
7. 未验证用户永不被戳
8. `wrangler tail` 显示每次 cron 的扫描日志（在线数、可发数、已发数）
