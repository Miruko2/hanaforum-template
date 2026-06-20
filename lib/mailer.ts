// 多通道发信 + 失败自动切换。目标：薅多家免费额度，一家满了自动切下一家；
// 全部满了才走「当日兜底放行」。
//
// 通道顺序：Resend(REST，主) → 通用 SMTP 兜底们(nodemailer，按 EMAIL_SMTP_FALLBACKS 顺序)。
// 加邮箱不用改代码，只在 Vercel 配环境变量：
//   EMAIL_SMTP_FALLBACKS = JSON 数组，元素 { host, port, user, pass, from, secure?, name? }
//   例：[{"host":"smtp-relay.brevo.com","port":587,"user":"xxx","pass":"yyy",
//        "from":"萤火虫之国 <noreply@mail.hanakos.cc>","name":"brevo"}]
//
// 失败分级（保留「乱填邮箱→发失败→自动过」的防绕过）：
//   sent    = 成功
//   quota   = 配额/限流(429 等) → 可切下一家；全是 quota → 路由走当日兜底放行
//   invalid = 收件地址无效(4xx/550 等) → 换家也没用，如实报错、绝不放行
//   error   = 网络/5xx/未知 → 如实报错、不放行（可重试）
import nodemailer from "nodemailer"
import { otpEmailSubject, otpEmailHtml, otpEmailText } from "./email-otp-template"

const RESEND_API_KEY = process.env.RESEND_API_KEY || ""
const RESEND_FROM = process.env.RESEND_FROM || ""

type SmtpFallback = {
  host: string
  port: number
  user: string
  pass: string
  from: string
  secure?: boolean
  name?: string
}

function parseSmtpFallbacks(): SmtpFallback[] {
  const raw = process.env.EMAIL_SMTP_FALLBACKS || ""
  if (!raw.trim()) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr
      .filter((p) => p && p.host && p.user && p.pass && p.from)
      .map((p, i) => ({
        host: String(p.host),
        port: Number(p.port) || 587,
        user: String(p.user),
        pass: String(p.pass),
        from: String(p.from),
        secure: !!p.secure,
        name: p.name ? String(p.name) : `smtp${i + 1}`,
      }))
  } catch (e) {
    console.error("[mailer] EMAIL_SMTP_FALLBACKS 解析失败（应为 JSON 数组）:", e)
    return []
  }
}

const smtpFallbacks = parseSmtpFallbacks()

/** 是否配置了任何发送通道。无任何通道时路由应直接放行当前用户（不动全局开关）。 */
export function hasAnyEmailProvider(): boolean {
  return (!!RESEND_API_KEY && !!RESEND_FROM) || smtpFallbacks.length > 0
}

type Outcome = "sent" | "quota" | "invalid" | "error"

export type SendOtpResult =
  | { ok: true; provider: string }
  | { ok: false; reason: "quota" | "invalid" | "error"; detail: string }

// ── Resend（REST API） ──
async function sendViaResend(to: string, code: string): Promise<Outcome> {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject: otpEmailSubject(code),
        html: otpEmailHtml(code),
        text: otpEmailText(code),
      }),
    })
    if (r.status >= 200 && r.status < 300) return "sent"
    const t = await r.text().catch(() => "")
    console.error("[mailer] Resend 失败:", r.status, t.slice(0, 200))
    if (r.status === 429) return "quota"
    if (r.status >= 400 && r.status < 500) return "invalid" // 地址/请求类 4xx
    return "error" // 5xx / 其它
  } catch (e) {
    console.error("[mailer] Resend 异常:", e)
    return "error"
  }
}

// ── 通用 SMTP（nodemailer） ──
async function sendViaSmtp(cfg: SmtpFallback, to: string, code: string): Promise<Outcome> {
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure ?? cfg.port === 465, // 465=隐式 TLS；587/25=STARTTLS
      auth: { user: cfg.user, pass: cfg.pass },
    })
    await transporter.sendMail({
      from: cfg.from,
      to,
      subject: otpEmailSubject(code),
      html: otpEmailHtml(code),
      text: otpEmailText(code),
    })
    return "sent"
  } catch (e: any) {
    const rc = Number(e?.responseCode || e?.code)
    const msg = String(e?.message || e)
    console.error(`[mailer] SMTP ${cfg.name}(${cfg.host}) 失败:`, e?.responseCode || e?.code, msg.slice(0, 200))
    // 配额/限流：SMTP 421/450/452/471，或文案含 limit/quota/rate/too many/exceed
    if ([421, 450, 452, 471].includes(rc) || /limit|quota|rate|too many|exceed/i.test(msg)) return "quota"
    // 收件人无效：501/550/553，或文案含 no such/invalid/mailbox/recipient/5.1.x
    if ([501, 550, 553].includes(rc) || /no such|invalid|mailbox|recipient|5\.1\./i.test(msg)) return "invalid"
    return "error"
  }
}

type Provider = { name: string; send: (to: string, code: string) => Promise<Outcome> }

function buildProviders(): Provider[] {
  const list: Provider[] = []
  if (RESEND_API_KEY && RESEND_FROM) list.push({ name: "resend", send: sendViaResend })
  for (const cfg of smtpFallbacks) {
    list.push({ name: cfg.name || cfg.host, send: (to, code) => sendViaSmtp(cfg, to, code) })
  }
  return list
}

/**
 * 依次尝试各通道发送 OTP，第一个成功即返回。全失败时按失败性质归类，
 * 供路由决定「当日兜底放行(quota)」还是「如实报错(invalid/error)」。
 */
export async function sendOtpEmail(to: string, code: string): Promise<SendOtpResult> {
  const providers = buildProviders()
  if (providers.length === 0) return { ok: false, reason: "error", detail: "no-provider" }

  let sawQuota = false
  let sawError = false
  let lastDetail = ""
  for (const p of providers) {
    const outcome = await p.send(to, code)
    if (outcome === "sent") return { ok: true, provider: p.name }
    if (outcome === "invalid") {
      // 地址坏，换通道也没用：立即停止并报错（绝不放行）
      return { ok: false, reason: "invalid", detail: `${p.name}:invalid` }
    }
    if (outcome === "quota") {
      sawQuota = true
      lastDetail = `${p.name}:quota`
    } else {
      sawError = true
      lastDetail = `${p.name}:error`
    }
  }
  // 全失败：仅当「清一色配额」才放行兜底；掺了网络/5xx 则当可重试错误处理
  if (sawQuota && !sawError) return { ok: false, reason: "quota", detail: lastDetail }
  return { ok: false, reason: "error", detail: lastDetail }
}

// ── 通用通知邮件（非 OTP）：发任意内容给站长（如「有人申请友链」站务提醒） ──
// 复用同一批通道（Resend 主 + SMTP 兜底），但正文任意。与 OTP 路径完全独立、互不影响。
// 失败不致命：调用方（如 friend-link-apply）自行兜底，邮件发不出也不影响主流程。
async function notifyViaResend(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html, text }),
    })
    if (r.status >= 200 && r.status < 300) return true
    const t = await r.text().catch(() => "")
    console.error("[mailer] 通知邮件 Resend 失败:", r.status, t.slice(0, 200))
    return false
  } catch (e) {
    console.error("[mailer] 通知邮件 Resend 异常:", e)
    return false
  }
}

async function notifyViaSmtp(
  cfg: SmtpFallback,
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure ?? cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    })
    await transporter.sendMail({ from: cfg.from, to, subject, html, text })
    return true
  } catch (e: any) {
    console.error(
      `[mailer] 通知邮件 SMTP ${cfg.name}(${cfg.host}) 失败:`,
      e?.responseCode || e?.code,
    )
    return false
  }
}

/**
 * 发一封任意内容的站务通知邮件。依次 Resend → SMTP 兜底，任一成功即 ok:true。
 * 无任何通道或全部失败返回 ok:false（调用方据此打日志，但不应中断主流程）。
 */
export async function sendNotifyEmail(opts: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<{ ok: boolean; provider?: string }> {
  const { to, subject, html, text } = opts
  if (RESEND_API_KEY && RESEND_FROM) {
    if (await notifyViaResend(to, subject, html, text)) return { ok: true, provider: "resend" }
  }
  for (const cfg of smtpFallbacks) {
    if (await notifyViaSmtp(cfg, to, subject, html, text)) {
      return { ok: true, provider: cfg.name || cfg.host }
    }
  }
  return { ok: false }
}
