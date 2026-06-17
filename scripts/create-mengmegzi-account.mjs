// 一次性脚本：创建私信AI「萌萌子」的独立 Supabase auth 账号。
//
// 背景：萌萌子要与弹幕墙AI「hanako」彻底分离成两个独立账号。
// dm_messages.sender_id 外键到 auth.users，故萌萌子需要真实 auth 账号。
// 账号创建后由 service-role 在私信路由里代发消息，AI 本身不登录，密码随机无需记忆。
//
// 运行：node --env-file=.env.local scripts/create-mengmegzi-account.mjs
// （或手动 export 环境变量后 node scripts/create-mengmegzi-account.mjs）
//
// 创建成功后把打印的 user.id 抄进 lib/hanako/constants.ts 的 MENGMEGZI_USER_ID。
// 本脚本保留在仓库供追溯，重复运行会报「user already exists」（邮箱唯一），属正常。

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 环境变量")
  process.exit(1)
}

// 随机 32 位强密码（AI 不登录，仅满足 Supabase 密码强度要求）
function randomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*"
  let s = ""
  const buf = new Uint32Array(32)
  globalThis.crypto.getRandomValues(buf)
  for (let i = 0; i < 32; i++) s += chars[buf[i] % chars.length]
  return s
}

const email = "mengmegzi@ai.local"
const password = randomPassword()

const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: "萌萌子" },
  }),
})

const data = await res.json()

if (!res.ok) {
  // 已存在则打印现有信息提示（不报错退出，便于重跑）
  console.error("创建失败:", res.status, JSON.stringify(data))
  process.exit(1)
}

console.log("=== 萌萌子账号创建成功 ===")
console.log("user.id =", data.id)
console.log("email  =", data.email)
console.log()
console.log("请把上面的 user.id 填入 lib/hanako/constants.ts 的 MENGMEGZI_USER_ID")
