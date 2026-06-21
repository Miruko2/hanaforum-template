// 邮箱验证码 / 重置密码验证码邮件模板。抽成共享模块，供多家发送通道（Resend REST / 通用 SMTP）
// 发出完全一致的邮件。两类码（邮箱验证 / 重置密码）共用同一套绝区零深色版式，仅文案不同。

// 邮件正文内图片/链接需用绝对地址（邮件客户端无法解析相对路径）
const SITE_URL = "https://forum.hanakos.cc"

// 单类码的文案差异点（版式完全一致，只换这几处）。
type CodeCopy = {
  subject: (code: string) => string
  htmlTitle: string // <title>
  preheader: (code: string) => string // 收件箱预览隐藏行
  badge: string // 顶部 mono 徽标尾词，如 PASSPORT / RESET
  heading: string // 主标题，如「萤火虫之国 · 邮箱验证」
  codeLabel: string // 验证码上方小标（可含 &nbsp;）
  introHtml: string // 正文说明（HTML）
  textLead: string // 纯文本首行的「码」名，如 邮箱验证码 / 重置密码验证码
  textHint: string // 纯文本提示句
}

const VERIFY: CodeCopy = {
  subject: (code) => `【萤火虫之国】验证码 ${code}`,
  htmlTitle: "萤火虫之国 · 验证码",
  preheader: (code) => `萤火虫之国邮箱验证码 ${code}，10 分钟内有效，请勿泄露。`,
  badge: "PASSPORT",
  heading: "萤火虫之国 · 邮箱验证",
  codeLabel: "VERIFY&nbsp;CODE&nbsp;/&nbsp;验证码",
  introHtml:
    '验证码 <span style="color:#2ee36b">10 分钟</span> 内有效，请勿向任何人泄露。<br>如果这不是你本人的操作，忽略此邮件即可，账号不受影响。',
  textLead: "邮箱验证码",
  textHint: "如果这不是你本人的操作，忽略此邮件即可，账号不受影响。",
}

const RESET: CodeCopy = {
  subject: (code) => `【萤火虫之国】重置密码验证码 ${code}`,
  htmlTitle: "萤火虫之国 · 重置密码",
  preheader: (code) => `萤火虫之国重置密码验证码 ${code}，10 分钟内有效，请勿泄露。`,
  badge: "RESET",
  heading: "萤火虫之国 · 重置密码",
  codeLabel: "RESET&nbsp;CODE&nbsp;/&nbsp;重置码",
  introHtml:
    '用此验证码 <span style="color:#2ee36b">10 分钟</span> 内完成密码重置，请勿向任何人泄露。<br>如果你没有申请重置密码，忽略此邮件即可，账号与密码不受影响。',
  textLead: "重置密码验证码",
  textHint: "如果你没有申请重置密码，忽略此邮件即可，账号与密码不受影响。",
}

// 纯文本兜底（多部分邮件的 text/plain 版，利于送达率与无图客户端）
function renderText(c: CodeCopy, code: string): string {
  return [
    `萤火虫之国 · ${c.textLead}：${code}`,
    "",
    "验证码 10 分钟内有效，请勿向任何人泄露。",
    c.textHint,
    "",
    "forum.hanakos.cc · 此邮件由系统自动发送，请勿回复",
  ].join("\n")
}

// 绝区零深色风 HTML 正文（吉祥物头图 + 霓虹绿码 + ASCII 萤火虫）
function renderHtml(c: CodeCopy, code: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${c.htmlTitle}</title>
</head>
<body style="margin:0;padding:0;background:#0b0d10">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0b0d10">${c.preheader(code)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0d10;padding:28px 12px">
<tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:480px;background:#15171a;border:1px solid #242832;border-radius:16px;overflow:hidden">
  <tr><td style="height:6px;line-height:6px;font-size:0;background:#2ee36b;background-image:repeating-linear-gradient(135deg,#2ee36b 0,#2ee36b 11px,#0b0d10 11px,#0b0d10 22px)">&nbsp;</td></tr>
  <tr><td style="padding:24px 28px 8px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;padding-right:14px">
        <img src="${SITE_URL}/icons/icon-192.png" width="52" height="52" alt="萤火虫之国" style="display:block;width:52px;height:52px;border-radius:12px;border:1px solid #2a2f38">
      </td>
      <td style="vertical-align:middle">
        <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;color:#2ee36b;font-size:11px;letter-spacing:2px;line-height:1.4">&#9635; HANAKOS&nbsp;//&nbsp;${c.badge}</div>
        <div style="color:#eef1f4;font-size:20px;font-weight:700;line-height:1.4;margin-top:3px">${c.heading}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:14px 28px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e1013;border:1px solid #2a2f38;border-radius:12px">
      <tr><td align="center" style="padding:22px 14px 24px">
        <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;color:#7af0a6;font-size:11px;letter-spacing:4px;margin-bottom:12px">${c.codeLabel}</div>
        <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:40px;font-weight:700;letter-spacing:12px;color:#2ee36b;text-shadow:0 0 14px rgba(46,227,107,0.45);padding-left:12px">${code}</div>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:16px 28px 4px;color:#a6aeb6;font-size:13px;line-height:1.8">
    ${c.introHtml}
  </td></tr>
  <tr><td align="center" style="padding:14px 20px 6px;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;color:#2ee36b;font-size:13px;letter-spacing:2px;line-height:1.5">
    ·&nbsp; &#730; &nbsp;&#10022;&nbsp; · &nbsp;&#8902;&nbsp; &#10022; &nbsp;&#730;&nbsp; · &nbsp;&#10022;&nbsp; &#8902; &nbsp;·&nbsp; &#730; &nbsp;&#10022;
  </td></tr>
  <tr><td style="padding:14px 28px 24px;border-top:1px solid #232730">
    <div style="font-family:'SFMono-Regular',Consolas,'Courier New',monospace;color:#5b636d;font-size:11px;letter-spacing:1px;line-height:1.6">
      <span style="color:#2ee36b">forum.hanakos.cc</span> &nbsp;·&nbsp; 此邮件由系统自动发送，请勿回复
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

// ── 邮箱验证 OTP（懒触发验证流程用） ──
export function otpEmailSubject(code: string): string {
  return VERIFY.subject(code)
}
export function otpEmailText(code: string): string {
  return renderText(VERIFY, code)
}
export function otpEmailHtml(code: string): string {
  return renderHtml(VERIFY, code)
}

// ── 重置密码验证码（忘记密码流程用） ──
export function resetEmailSubject(code: string): string {
  return RESET.subject(code)
}
export function resetEmailText(code: string): string {
  return renderText(RESET, code)
}
export function resetEmailHtml(code: string): string {
  return renderHtml(RESET, code)
}
