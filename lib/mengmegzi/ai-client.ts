// lib/mengmegzi/ai-client.ts
//
// 调文本 AI（OpenAI 兼容 /chat/completions）+ JSON 鲁棒解析。
// 复用 dm_ai_config 的 base_url/api_key/model/persona（与私信 AI 同一套模型配置）。

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
  if (!s) return null
  // 去 ``` 围栏（含可选的 json 标记）
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
 * 超时 120s（2 分钟）：足够推理模型，又不至于卡死整个 tick。
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
    signal: AbortSignal.timeout(120000),
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
