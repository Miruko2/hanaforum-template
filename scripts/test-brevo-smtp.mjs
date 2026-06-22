// 一次性本地测试：用 EMAIL_SMTP_FALLBACKS 里第一个 SMTP 通道(Brevo)直接发一封测试信，
// 验证「SMTP 凭据 + 发件域名验证」是否真能发出。与生产 lib/mailer.ts 走同一套发送逻辑。
//
// 用法(PowerShell)：
//   $env:EMAIL_SMTP_FALLBACKS='[{"host":"smtp-relay.brevo.com","port":587,"user":"...","pass":"...","from":"Hanakos <noreply@mail.hanakos.cc>","name":"brevo"}]'
//   node scripts/test-brevo-smtp.mjs 收件邮箱@example.com
import nodemailer from "nodemailer"

const to = process.argv[2]
if (!to) {
  console.error("用法: node scripts/test-brevo-smtp.mjs <收件邮箱>")
  process.exit(1)
}

let cfgs
try {
  cfgs = JSON.parse(process.env.EMAIL_SMTP_FALLBACKS || "")
} catch {
  console.error("✗ EMAIL_SMTP_FALLBACKS 没设或不是合法 JSON")
  process.exit(1)
}
if (!Array.isArray(cfgs) || cfgs.length === 0) {
  console.error("✗ EMAIL_SMTP_FALLBACKS 为空")
  process.exit(1)
}

const cfg = cfgs[0] // 第一个 = Brevo
const port = Number(cfg.port) || 587
console.log(`通道   : ${cfg.name || cfg.host}`)
console.log(`服务器 : ${cfg.host}:${port}`)
console.log(`发件人 : ${cfg.from}`)
console.log(`收件人 : ${to}`)
console.log("连接 + 发送中…(国内连 Brevo 若被墙会超时；超时≠Brevo坏，生产从 Vercel 发不受影响)\n")

const transporter = nodemailer.createTransport({
  host: cfg.host,
  port,
  secure: port === 465,
  auth: { user: cfg.user, pass: cfg.pass },
  connectionTimeout: 20000,
  greetingTimeout: 20000,
})

try {
  const info = await transporter.sendMail({
    from: cfg.from,
    to,
    subject: "【萤火虫之国】Brevo 通道测试 · 123456",
    text: "Brevo SMTP 测试信。验证码 123456。收到即说明 Brevo 兜底通道可用。",
    html: '<div style="font-family:sans-serif"><p>Brevo SMTP 测试信。</p><p>验证码 <b style="color:#2ee36b">123456</b></p><p>收到即说明 <b>Brevo 兜底通道可用</b>。</p></div>',
  })
  console.log("✅ 发送成功！Brevo 接受了这封信（凭据 / 发件域名都 OK）")
  console.log("   messageId:", info.messageId)
  console.log("   response :", info.response)
  console.log("   → 去收件箱(含垃圾箱)确认收到即彻底坐实。")
} catch (e) {
  const msg = e && e.message ? e.message : String(e)
  console.error("❌ 发送失败:", msg)
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|timeout/i.test(String((e && e.code) || msg))) {
    console.error("   → 像是连不上 Brevo 服务器，多半国内被墙。不代表 Brevo 坏；")
    console.error("     生产从 Vercel(美国)发，不受影响。可改走 Vercel 侧测试。")
  } else if (/535|auth|credential|invalid login/i.test(msg)) {
    console.error("   → 认证失败：SMTP 用户名/密码(key)不对，去 Brevo 重新生成 SMTP key。")
  } else if (/from|sender|domain|not.*verif/i.test(msg)) {
    console.error("   → 发件人/域名问题：确认 mail.hanakos.cc 在 Brevo 已验证、from 用该域名地址。")
  }
  process.exit(1)
}
