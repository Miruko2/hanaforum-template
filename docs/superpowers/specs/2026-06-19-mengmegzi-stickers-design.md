# 萌萌子发帖/评论带表情包 —— 设计文档

**日期**：2026-06-19
**范围**：让萌萌子（虚拟用户 `MENGMEGZI_USER_ID`）在自动发帖、留言、回复时，生成的文字里能带上 `[s:表情名]` 标记，从而在前端渲染成内联表情包图。

---

## 一、背景

项目已有一套完整的表情包设施，**本次不新增任何基础设施**：

- **6 个表情**：`happy / shy / confused / cuddle / excited / sleepy`（见 `lib/stickers.ts` 的 `STICKERS`）
- **标记格式**：`[s:名字]`，纯文本，直接嵌在正文里
- **渲染**：`components/stickers/sticker-text.tsx` 的 `StickerText` 组件已识别标记并渲染成内联表情图，**已用在帖子正文和评论展示**（`post-detail-modal.tsx`、`comment-item.tsx`）
- **存储**：标记是纯文本，存在现有 `content` 字段里，**不需要新增数据库列**
- **来源**：表情图是 `/hanako/stickers/<name>.<ext>` 下的静态资源，不经过 Supabase Storage / sharp

聊天窗（私信）里萌萌子已经能发表情包，本设计**对齐聊天窗的既有逻辑**：
- `lib/hanako/dm-ai.ts` 的 `buildDmSystemPrompt` 里专门有一节列出 6 个表情的「名（含义）」清单引导模型
- `app/api/hanako-dm/route.ts` 按 `DM_STICKER_INJECT_PROBABILITY = 0.55` 在上下文末尾临时注入一条 system 提示推高命中率

---

## 二、需求确认（与用户对齐的决策）

| 维度 | 决策 |
|---|---|
| 谁决定用哪个表情、何时用 | **AI 自己挑**（参考聊天窗逻辑） |
| 频率控制 | **prompt 引导 + 概率助推**（对齐聊天窗） |
| 作用范围 | **发帖正文 + 留言 + 回复** 三个动作都要 |
| 概率值管理 | **写死在 `constants.ts`**（不入库、不加面板 UI） |
| AI 输出未知表情名 / 没发表情 | **不清洗，自然兜底**（`parseStickerText` 已会原样保留未知标记为文字） |

---

## 三、改动范围

**只动 `lib/mengmegzi/` 这一层，共 3 个文件，不动数据库、不动前端、不动图片管线。**

### 1. `lib/mengmegzi/constants.ts`

新增一个常量：

```ts
/** 萌萌子发帖/留言/回复带表情包的目标概率（对齐私信 DM_STICKER_INJECT_PROBABILITY）。
 *  prompt 已引导「适当用」，但模型偏保守，故按此概率在上下文末尾临时注入一条
 *  「本轮配个表情包」的 system 提示推高命中率。该提示只活在本次请求、不写库。
 *  0.5 ≈ 一半的动作带表情包：活泼有萌点但不刷屏（帖子正文是长文，比私信稍保守）。 */
export const STICKER_INJECT_PROBABILITY = 0.5
```

### 2. `lib/mengmegzi/prompts.ts`

**三套 prompt 各加一节「发表情包」说明**，复用 `STICKERS` + `emotionLabel` 生成清单，不写死表情名。

新增一个清单构建辅助（与 `dm-ai.ts` 的 `STICKER_GUIDE` 同款手法）：

```ts
import { STICKERS } from "@/lib/stickers"
import { emotionLabel } from "@/lib/hanako/constants"

const STICKER_GUIDE = STICKERS.map((id) => `${id}（${emotionLabel(id)}）`).join("、")
```

**与私信的关键差异 —— 内联而非单独成条**：

私信气泡不支持图文混排，所以聊天窗强制"表情包单独成条、不要混进文字"。但帖子正文和评论用的是 `StickerText`，**支持 `[s:name]` 内联混排在文字里**（用户在评论框就是用 `StickerPicker` 在光标处插入的，自然嵌在句子里）。所以萌萌子的 prompt 引导改为内联风格：

```
=== 发表情包（适当用） ===
- 你可以在 content 里夹一个 [s:表情名] 表达情绪，自然地嵌在句子里（通常放句末）。
- 可用表情名（含义）：${STICKER_GUIDE}。表情名只能从这里面选，不要自创。
- 适当用，别每句都带；情绪贴切时加一个就好，长正文里 0~1 个最自然。
- 表情标记只放在 content 里，不要放进 title / description。
- 例：「今天天气真好呀 [s:happy]」「这个问题我也卡过 [s:confused]」
```

**三个 prompt 的注入点**：
- `buildPostSystemPrompt`：在 JSON 输出格式说明之前加表情包一节
- `buildCommentSystemPrompt`：同上
- `buildReplySystemPrompt`：同上

### 3. `lib/mengmegzi/executor.ts`

三处 `callAiForJson` 调用前，**按概率在 messages 末尾临时注入一条 system 提示**，与 `hanako-dm/route.ts` 完全同款手法：

```ts
import { STICKER_INJECT_PROBABILITY } from "./constants"

// 在 executePost / executeComment / executeReply 里：
const wantSticker = Math.random() < STICKER_INJECT_PROBABILITY
const finalMessages = wantSticker
  ? [
      ...messages,
      {
        role: "system" as const,
        content:
          "本轮输出请带上一个表情包（在 content 里夹一个 [s:表情名]，自然嵌在句末），挑一个最贴合当下情绪的。注意表情名只能从清单里选。",
      },
    ]
  : messages

const gen = (await callAiForJson(cfg, finalMessages, ...)) as ...
```

**关键点**（与聊天窗一致）：
- 这条 system 提示**只活在本次请求**，不写库、不进任何持久状态
- 每次执行独立掷骰，下一条消息重新决定
- 放在 messages 末尾（紧贴模型要回复的位置）效果最直接

**抽一个 helper 避免三处重复**（`lib/mengmegzi/prompts.ts` 或 `executor.ts` 内）：

```ts
/** 按概率在 messages 末尾临时注入「本轮配个表情包」的 system 提示。
 *  提示只活在本次请求、不写库。命中返回新数组，未命中返回原数组。 */
export function maybeInjectStickerBoost(
  messages: { role: "system" | "user"; content: string }[],
): { role: "system" | "user"; content: string }[] {
  if (Math.random() >= STICKER_INJECT_PROBABILITY) return messages
  return [
    ...messages,
    {
      role: "system",
      content:
        "本轮输出请带上一个表情包（在 content 里夹一个 [s:表情名]，自然嵌在句末），挑一个最贴合当下情绪的。注意表情名只能从清单里选。",
    },
  ]
}
```

三处 `callAiForJson` 调用统一改成 `callAiForJson(cfg, maybeInjectStickerBoost(messages), ...)`。

---

## 四、不做什么（明确排除）

- ❌ **不加数据库列**：标记是纯文本，存现有 `content` 字段
- ❌ **不改前端**：`StickerText` 已在帖子和评论展示里用，自动识别标记
- ❌ **不改 admin 面板**：概率写死在 constants
- ❌ **不改图片管线**：表情包是静态资源，不经过 Storage / sharp / Unsplash
- ❌ **不碰发帖配图逻辑**：那是 Unsplash 下载压缩上传的「帖子大图」，和「内联表情包」是两码事，互不干扰
- ❌ **不做输出清洗/纠错**：让 `parseStickerText` 的自然兜底生效

---

## 五、兜底与边界情况（零额外逻辑）

| 情况 | 行为 | 为什么不用管 |
|---|---|---|
| AI 没发表情（wantSticker=false 或模型忽略） | 纯文字帖/评论，照常出 | 和现在行为一致 |
| AI 自创了 `[s:angry]` 这种不存在的名 | `parseStickerText` 原样当文字保留，渲染成字面 `[s:angry]` 不崩 | 与用户在评论框手敲错误标记的行为完全一致 |
| AI 把标记混进 JSON 字符串值里 | JSON 正常解析，标记进 content 字段，`StickerText` 渲染时识别 | JSON 转义由 `callAiForJson` 处理 |
| AI 把标记放进 title/description | title/description 是纯文本展示，标记会字面显示成 `[s:happy]` | prompt 已明确说"只放 content 里"规避 |

---

## 六、与聊天窗（私信）的对比

| 维度 | 私信（已有） | 帖子/评论（本设计） |
|---|---|---|
| 渲染组件 | DM 气泡（不支持混排） | `StickerText`（支持内联混排） |
| 表情放置方式 | 单独成条 `[s:name]` | 内联嵌在 content 文字里 |
| prompt 密度引导 | "约一半以上回复都该带" | "适当用，别每句都带，长正文 0~1 个" |
| 概率助推值 | `DM_STICKER_INJECT_PROBABILITY = 0.55` | `STICKER_INJECT_PROBABILITY = 0.5` |
| 助推注入手法 | 末尾临时 system 提示，不写库 | 完全相同 |
| 清洗未知标记 | 不清洗（`splitRepliesIntoRows` 原样保留） | 不清洗（`parseStickerText` 原样保留） |

---

## 七、验证方式

1. 本地起 dev server + 后台 tick 轮询器（或直接发单发指令）
2. 点「发一帖」若干次，检查生成的帖子正文里是否出现 `[s:xxx]` 标记，前端是否渲染成表情图
3. 在某帖点「萌萌子留言」、在某评论点机器人按钮，检查评论/回复是否带表情
4. 反复触发（10+ 次）确认约一半带表情，不刷屏
5. 检查若 AI 自创未知名，前端是否原样显示文字而不崩
6. 确认 title/description 里没混进标记

---

## 八、文件清单

```
修改（3 个文件）：
lib/mengmegzi/constants.ts   新增 STICKER_INJECT_PROBABILITY = 0.5
lib/mengmegzi/prompts.ts     三套 prompt 各加「发表情包」一节 + STICKER_GUIDE 辅助
lib/mengmegzi/executor.ts    三处 callAiForJson 前按概率注入 system 提示
```

无新增文件、无数据库改动、无前端改动、无环境变量改动。
