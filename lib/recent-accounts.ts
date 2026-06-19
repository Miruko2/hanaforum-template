// 本设备「最近登录账号」轻量缓存（仅 localStorage、不出本机）。
// 用途：登录页输入邮箱时，若匹配上本机登录过的账号，把点阵显示换成该账号头像（「欢迎回来」）。
//
// 安全说明：故意只认「本设备登录成功过」的账号、且只存在本机。
// 不做任何按邮箱的服务端查询——那会形成账号枚举漏洞（任何人可探测某邮箱是否注册）。
// 这里的数据本就是用户自己在本机登录过的、低敏感，匹配范围被限制在本设备已知账号内。

const STORAGE_KEY = "hanako:recent-accounts"
const MAX_ENTRIES = 5

export interface RecentAccount {
  email: string // 归一化后（trim + 小写）
  avatarUrl: string | null
  username: string | null
  ts: number
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()

/** 读取本机最近账号列表（最新在前）。SSR / 隐私模式安全返回空数组。 */
export function getRecentAccounts(): RecentAccount[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const list = JSON.parse(raw)
    if (!Array.isArray(list)) return []
    return list.filter((x) => x && typeof x.email === "string")
  } catch {
    return []
  }
}

/** 记住一个刚登录成功的账号（去重 + 置顶 + 截断到 MAX_ENTRIES）。 */
export function rememberAccount(email: string, avatarUrl: string | null, username: string | null) {
  if (typeof window === "undefined" || !email) return
  const key = normalizeEmail(email)
  try {
    const rest = getRecentAccounts().filter((a) => a.email !== key)
    const next: RecentAccount[] = [{ email: key, avatarUrl, username, ts: Date.now() }, ...rest].slice(0, MAX_ENTRIES)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 隐私模式 / 配额满：静默忽略，功能降级为「不出头像」即可
  }
}

/** 在已加载的列表里精确匹配某邮箱（完整、归一化相等才算）。 */
export function matchAccount(list: RecentAccount[], email: string): RecentAccount | null {
  if (!email) return null
  const key = normalizeEmail(email)
  return list.find((a) => a.email === key) || null
}

/** 忘掉某个本机账号（供「不是你？」之类入口调用，目前未接 UI）。 */
export function forgetAccount(email: string) {
  if (typeof window === "undefined" || !email) return
  const key = normalizeEmail(email)
  try {
    const next = getRecentAccounts().filter((a) => a.email !== key)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* noop */
  }
}
