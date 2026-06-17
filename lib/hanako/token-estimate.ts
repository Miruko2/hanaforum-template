/**
 * 轻量 token 估算 —— 不依赖 tokenizer 库（私信模型可能是 deepseek/gpt/qwen 等，
 * 各自 tokenizer 不同，且服务端引 tiktoken 体积大、需对应编码）。
 *
 * 用启发式估算，目的是「滑窗裁剪上下文」时有个一致的比例尺，不需要精确到个位。
 * 经验上对中英混合文本误差在 ±20% 内，足够决定「带哪几条消息进窗口」。
 *
 * 规则：
 *   - CJK 字符（中日韩，含全角标点）：约 1 字 ≈ 1 token（CJK 在多数 BPE 里偏密）
 *   - 其余（ASCII/拉丁）：约 4 字符 ≈ 1 token
 *   - 每条 chat message 额外计 ~4 token 的 role/分隔开销
 */

/** 估算一段文本的 token 数 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    // CJK 统一表意 + 常见 CJK 区块（中日韩、全角标点、平假名/片假名等）
    if (
      (code >= 0x3000 && code <= 0x30ff) || // CJK 标点 + 假名
      (code >= 0x3400 && code <= 0x4dbf) || // CJK 扩展 A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 基本块
      (code >= 0xf900 && code <= 0xfaff)    // CJK 兼容表意
    ) {
      cjk++
    } else {
      other++
    }
  }
  // CJK ~1 token/字；其余 ~4 字符/token
  return cjk + Math.ceil(other / 4)
}

/** 估算一组 chat messages 的总 token 数（含每条 role 开销） */
export function estimateMessagesTokens(
  messages: { role: string; content: string }[],
): number {
  let total = 0
  for (const m of messages) {
    total += estimateTokens(m.content) + 4 // role 标签 + 分隔的固定开销
  }
  return total
}
