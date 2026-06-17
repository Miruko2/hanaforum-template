/**
 * Hanako 的联网搜索能力。
 *
 * 设计要点：
 * - 默认接 Tavily（为 LLM/agent 优化：返回精简正文 + 可选 answer 摘要，
 *   喂回模型的 token 比通用搜索 API 少很多）。想换 Brave/Serper 只改本文件。
 * - 优雅降级：没配 TAVILY_API_KEY 时 isWebSearchEnabled() 返回 false，
 *   路由就完全不挂工具、行为和从前一模一样，绝不影响现有回复。
 * - 成本/稳健：单次结果数量与正文长度都截断；8 秒超时，绝不让一次搜索
 *   拖死整个回复；任何异常都返回一句"搜索失败"文本，让模型自己兜底。
 * - Kill switch：环境变量 HANAKO_WEB_SEARCH=off 可在不删 key 的前提下临时停用。
 */

const TAVILY_ENDPOINT = "https://api.tavily.com/search"
const MAX_RESULTS = 4
const MAX_CONTENT_CHARS = 400 // 每条结果正文截断，控制喂回模型的 token
const SEARCH_TIMEOUT_MS = 8000

/** 后端是否启用了联网搜索（决定是否给模型挂 web_search 工具） */
export function isWebSearchEnabled(): boolean {
  return !!process.env.TAVILY_API_KEY && process.env.HANAKO_WEB_SEARCH !== "off"
}

/**
 * OpenAI 风格的工具定义。模型决定何时调用；后端在 route 里执行 searchWeb 并回灌结果。
 */
export const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "联网搜索。当主人问到你不知道或需要最新/实时信息（新闻、天气、比分、价格、近期事件、具体事实）时调用；日常闲聊和情感陪伴不要调用。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词，简洁准确，中英文均可",
        },
      },
      required: ["query"],
    },
  },
} as const

/**
 * 执行一次联网搜索，返回喂给模型的纯文本（已截断）。
 * 失败时返回一句中文说明而非抛错，让模型据此自然回应。
 */
export async function searchWeb(query: string): Promise<string> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return "（联网搜索未配置）"

  const q = query.trim().slice(0, 200)
  if (!q) return "（搜索关键词为空）"

  try {
    const res = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query: q,
        max_results: MAX_RESULTS,
        search_depth: "basic",
        include_answer: true,
      }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    })

    if (!res.ok) {
      console.warn("[Hanako] 搜索失败:", res.status)
      return `（搜索失败：HTTP ${res.status}）`
    }

    const data = (await res.json()) as {
      answer?: string
      results?: { title?: string; content?: string; url?: string }[]
    }

    const lines: string[] = []
    if (data.answer) {
      lines.push(`摘要：${data.answer.slice(0, MAX_CONTENT_CHARS)}`)
    }
    for (const r of (data.results || []).slice(0, MAX_RESULTS)) {
      const title = (r.title || "").slice(0, 120)
      const content = (r.content || "").slice(0, MAX_CONTENT_CHARS)
      lines.push(`- ${title}\n  ${content}\n  来源: ${r.url || ""}`)
    }

    return lines.length > 0 ? lines.join("\n") : "（没搜到相关结果）"
  } catch (err: any) {
    const reason = err?.name === "TimeoutError" ? "超时" : "网络错误"
    console.warn("[Hanako] 搜索异常:", reason, err?.message)
    return `（搜索${reason}，没查到）`
  }
}
