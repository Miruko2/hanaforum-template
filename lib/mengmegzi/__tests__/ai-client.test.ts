// lib/mengmegzi/__tests__/ai-client.test.ts
//
// JSON 鲁棒解析测试。LLM 常在 JSON 外裹围栏或加说明，解析逻辑要去掉这些。

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

  test("嵌套 JSON 也能解析", () => {
    const raw = '```json\n{"replies":["a","b"],"optOut":false}\n```'
    expect(parseJsonFromLlm(raw)).toEqual({ replies: ["a", "b"], optOut: false })
  })

  test("非法 JSON 返回 null", () => {
    expect(parseJsonFromLlm("这不是JSON")).toBeNull()
    expect(parseJsonFromLlm("")).toBeNull()
    expect(parseJsonFromLlm("   ")).toBeNull()
  })

  test("没有花括号返回 null", () => {
    expect(parseJsonFromLlm("只有文字没有花括号")).toBeNull()
  })

  test("只有左花括号返回 null", () => {
    expect(parseJsonFromLlm("{不完整")).toBeNull()
  })
})
