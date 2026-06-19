// 聊天「日期跳转」用的日期工具。统一按 Asia/Shanghai 切天（受众在国内，
// "6月3日" 按本地日；服务端 RPC dm_active_dates 也用同一时区，两端一致）。

export interface DateBucket {
  d: string // "YYYY-MM-DD"（上海当地日）
  cnt: number // 当日消息条数（波形皮肤按它当振幅；刻度轨可忽略）
}

// 复用单个 formatter（en-CA 本地化即 "YYYY-MM-DD"），避免每次 new。
const SH_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

// ISO(UTC) 时刻 → 上海当地日期 "YYYY-MM-DD"
export function cnDate(iso: string): string {
  try {
    return SH_FMT.format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

// 上海某日 D 的 UTC 起止：[D 00:00+08:00, 次日 00:00+08:00)。
// 上海无夏令时、恒 UTC+8，故直接用 +08:00 偏移构造即可。
export function cnDayRangeUTC(dateStr: string): { startUTC: string; endUTC: string } {
  const start = new Date(`${dateStr}T00:00:00+08:00`)
  const end = new Date(start.getTime() + 86_400_000)
  return { startUTC: start.toISOString(), endUTC: end.toISOString() }
}

// 日期 → 展示标签：今天 / 昨天 / M月D日
export function cnDateLabel(dateStr: string): string {
  const today = cnDate(new Date().toISOString())
  if (dateStr === today) return "今天"
  const y = new Date(`${today}T00:00:00+08:00`)
  y.setDate(y.getDate() - 1)
  if (dateStr === cnDate(y.toISOString())) return "昨天"
  const p = dateStr.split("-")
  return `${parseInt(p[1], 10)}月${parseInt(p[2], 10)}日`
}

const WD_FMT = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", weekday: "short" })

// 日期 → 周几（上海时区），如 "周三"
export function cnWeekday(dateStr: string): string {
  try {
    return WD_FMT.format(new Date(`${dateStr}T12:00:00+08:00`))
  } catch {
    return ""
  }
}
