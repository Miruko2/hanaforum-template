import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { sendNotifyEmail } from "@/lib/mailer"

// 友链申请收集：访客在 /links 页填表 → 这里校验 / 防刷 / 入库 → 通知管理员（站内铃铛 + 邮件）。
// 公开端点（无需登录）。写入用 service_role 绕 RLS；防刷在本层做（蜜罐 + 频率限制 + 字段校验）。
// 关键取舍：邮件 / 通知失败都【不影响】「提交成功」—— 入库才是事实来源，提醒尽力而为。
export const dynamic = "force-dynamic"

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const MAX = { name: 40, url: 300, desc: 120, contact: 80 }
const HOURLY_IP_LIMIT = 3 // 同一 IP 每小时最多 3 条
const DAILY_IP_LIMIT = 8 // 同一 IP 每天最多 8 条

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for") || ""
  const first = xff.split(",")[0].trim()
  return first || req.headers.get("x-real-ip") || "unknown"
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

// HTML 转义：用户输入进邮件正文前一律转义，杜绝 HTML / 脚本注入。
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  )
}

type Fields = {
  siteName: string
  siteUrl: string
  iconUrl: string
  description: string
  contact: string
  ip: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    // 蜜罐：真实用户看不到也填不到 website 字段；机器人填了 → 静默「假成功」丢弃。
    if (typeof body.website === "string" && body.website.trim() !== "") {
      return NextResponse.json({ ok: true })
    }

    const siteName = String(body.siteName ?? "").trim()
    const siteUrl = String(body.siteUrl ?? "").trim()
    const iconUrl = String(body.iconUrl ?? "").trim()
    const description = String(body.description ?? "").trim()
    const contact = String(body.contact ?? "").trim()

    // 字段校验（后端兜底，前端校验只是体验）
    if (!siteName || siteName.length > MAX.name)
      return NextResponse.json({ error: "站名必填，且不超过 40 字" }, { status: 400 })
    if (!siteUrl || siteUrl.length > MAX.url || !isHttpUrl(siteUrl))
      return NextResponse.json({ error: "请填写合法的网站地址（http / https）" }, { status: 400 })
    if (iconUrl && (iconUrl.length > MAX.url || !isHttpUrl(iconUrl)))
      return NextResponse.json({ error: "icon 链接需是合法的 http / https 地址" }, { status: 400 })
    if (description.length > MAX.desc)
      return NextResponse.json({ error: "简介不超过 120 字" }, { status: 400 })
    if (!contact || contact.length > MAX.contact)
      return NextResponse.json({ error: "联系方式必填，且不超过 80 字" }, { status: 400 })

    const ip = clientIp(req)
    const ua = (req.headers.get("user-agent") || "").slice(0, 300)

    // 频率限制（按 IP，基于库里近期计数）。查询出错则放行（fail-open，别误伤真人）。
    if (ip !== "unknown") {
      try {
        const since1h = new Date(Date.now() - 3600_000).toISOString()
        const since1d = new Date(Date.now() - 86400_000).toISOString()
        const [h, d] = await Promise.all([
          supabaseAdmin
            .from("friend_link_submissions")
            .select("id", { count: "exact", head: true })
            .eq("submitter_ip", ip)
            .gte("created_at", since1h),
          supabaseAdmin
            .from("friend_link_submissions")
            .select("id", { count: "exact", head: true })
            .eq("submitter_ip", ip)
            .gte("created_at", since1d),
        ])
        if ((h.count ?? 0) >= HOURLY_IP_LIMIT || (d.count ?? 0) >= DAILY_IP_LIMIT) {
          return NextResponse.json({ error: "提交太频繁了，请稍后再试" }, { status: 429 })
        }
      } catch (e) {
        console.warn("[friend-link-apply] 频率检查失败，放行:", e)
      }
    }

    // 入库（service_role 绕 RLS）
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("friend_link_submissions")
      .insert({
        site_name: siteName,
        site_url: siteUrl,
        icon_url: iconUrl || null,
        description: description || null,
        contact,
        submitter_ip: ip === "unknown" ? null : ip,
        user_agent: ua || null,
      })
      .select("id, created_at")
      .single()

    if (insErr) {
      console.error("[friend-link-apply] 入库失败:", insErr)
      return NextResponse.json({ error: "提交失败，请稍后重试" }, { status: 500 })
    }

    // —— 以下「提醒」尽力而为，任何失败都不影响提交成功 ——
    try {
      const { data: admins } = await supabaseAdmin.from("admin_users").select("user_id")

      // ① 站内通知：给每个管理员各写一条 friend_link_apply（铃铛红点 + 通知页）。
      //    meta 存整条申请快照——点击通知即弹「公告同款」详情弹窗、完整展示，无需回查表。
      if (admins?.length) {
        const summary = `🔗 新友链申请：${siteName}（${siteUrl}）｜联系：${contact}`
        const meta = {
          site_name: siteName,
          site_url: siteUrl,
          icon_url: iconUrl || null,
          description: description || null,
          contact,
          created_at: inserted.created_at,
        }
        const { error: notifyErr } = await supabaseAdmin.from("notifications").insert(
          admins.map((a: { user_id: string }) => ({
            user_id: a.user_id,
            type: "friend_link_apply",
            post_id: null,
            comment_id: null,
            actor_id: null,
            message: summary,
            is_read: false,
            meta,
          })),
        )
        if (notifyErr) console.error("[friend-link-apply] 写站内通知失败:", notifyErr)
      }

      // ② 邮件：发给管理员（收件人优先取 ADMIN_NOTIFY_EMAIL，否则回落到管理员登录邮箱）
      const to = process.env.ADMIN_NOTIFY_EMAIL || (await resolveAdminEmail(admins))
      if (to) {
        const f: Fields = { siteName, siteUrl, iconUrl, description, contact, ip }
        const r = await sendNotifyEmail({
          to,
          subject: `【友链申请】${siteName}`,
          html: buildEmailHtml(f),
          text: buildEmailText(f),
        })
        if (!r.ok) console.warn("[friend-link-apply] 通知邮件未发出（通道满 / 未配 ADMIN_NOTIFY_EMAIL）")
      } else {
        console.warn("[friend-link-apply] 未解析到管理员邮箱，跳过邮件")
      }
    } catch (e) {
      console.error("[friend-link-apply] 通知 / 邮件异常（不影响提交）:", e)
    }

    return NextResponse.json({ ok: true, id: inserted.id })
  } catch (e: any) {
    console.error("[friend-link-apply] 未知错误:", e)
    return NextResponse.json({ error: e?.message || "服务器错误" }, { status: 500 })
  }
}

// 没配 ADMIN_NOTIFY_EMAIL 时，用 service_role 查管理员的登录邮箱作收件人（零配置兜底）。
async function resolveAdminEmail(admins?: { user_id: string }[] | null): Promise<string | null> {
  if (!admins?.length) return null
  for (const a of admins) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(a.user_id)
      if (data?.user?.email) return data.user.email
    } catch {
      /* 取不到就试下一个 */
    }
  }
  return null
}

function buildEmailText(d: Fields): string {
  return [
    "有人申请和「萤火虫之国」交换友链：",
    "",
    `站名：${d.siteName}`,
    `网址：${d.siteUrl}`,
    d.iconUrl ? `Icon：${d.iconUrl}` : "",
    d.description ? `简介：${d.description}` : "",
    `联系方式：${d.contact}`,
    "",
    `来源 IP：${d.ip}`,
    "—— 到 forum.hanakos.cc/links 或代码里的 FRIEND_SITES 数组决定是否收录。",
  ]
    .filter(Boolean)
    .join("\n")
}

// 绝区零深色风简版邮件；所有用户输入经 esc() 转义后再入 HTML。
function buildEmailHtml(d: Fields): string {
  const row = (k: string, v: string) =>
    v
      ? `<tr><td style="padding:6px 14px;color:#9ca3af;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 14px;color:#e5e7eb;word-break:break-all">${esc(v)}</td></tr>`
      : ""
  const linkRow = (k: string, v: string) =>
    v
      ? `<tr><td style="padding:6px 14px;color:#9ca3af;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 14px;word-break:break-all"><a href="${esc(v)}" style="color:#a3e635;text-decoration:none">${esc(v)}</a></td></tr>`
      : ""
  return `<div style="background:#0a0a0f;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:0 auto;background:rgba(20,22,30,.96);border:1px solid rgba(163,230,53,.25);border-radius:16px;overflow:hidden">
    <div style="padding:16px 20px;background:rgba(163,230,53,.12);border-bottom:1px solid rgba(163,230,53,.2)">
      <span style="color:#a3e635;font-size:16px;font-weight:700">🔗 新友链申请</span>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:8px 0">
      ${row("站名", d.siteName)}
      ${linkRow("网址", d.siteUrl)}
      ${linkRow("Icon", d.iconUrl)}
      ${row("简介", d.description)}
      ${row("联系方式", d.contact)}
      ${row("来源 IP", d.ip)}
    </table>
    <div style="padding:12px 20px;color:#6b7280;font-size:12px;border-top:1px solid rgba(255,255,255,.06)">
      到 forum.hanakos.cc/links 或代码里的 FRIEND_SITES 数组决定是否收录。
    </div>
  </div>
</div>`
}
