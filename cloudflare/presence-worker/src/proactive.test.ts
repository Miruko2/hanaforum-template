// 用 Node 内置 test runner（零依赖，worker 无 vitest）
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { filterEligible, pickOpener, type Candidate, type DmAiConfig } from "./proactive.ts"

const CONFIG: DmAiConfig = { proactiveEnabled: true, cooldownHours: 24, maxUnanswered: 2 }
const NOW = new Date("2026-06-18T12:00:00Z")
const WITHIN_COOLDOWN = new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString() // 1 小时前
const OUTSIDE_COOLDOWN = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString() // 25 小时前

function base(over: Partial<Candidate> = {}): Candidate {
  return {
    userId: "u1",
    state: { userId: "u1", optedOut: false, lastProactiveAt: null, unansweredStreak: 0 },
    profile: { id: "u1", username: "小明" },
    active: true,
    hadRecentMessage: false,
    ...over,
  }
}

describe("filterEligible", () => {
  test("全新活跃用户通过", () => {
    const out = filterEligible([base()], CONFIG, NOW)
    assert.equal(out.length, 1)
  })

  test("非活跃用户（没发过帖/评论/弹幕）被排除", () => {
    const out = filterEligible([base({ active: false })], CONFIG, NOW)
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
        base({ userId: "no1", active: false }),
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
