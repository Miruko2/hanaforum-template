"use client"

import { useSimpleAuth } from "@/contexts/auth-context-simple"
import { Ban } from "lucide-react"

/**
 * 全站封禁页：当登录账号处于封禁中时，由 BannedGate 用它整屏接管，
 * 站内所有功能都触达不到。只保留一个“退出登录”出口。
 *
 * 注意：这是 App 层的访问门禁（账号级）。真正的写入拦截在数据库 RLS / RPC 层，
 * 二者配合 = 被封账号既看不到功能、也写不进数据。对方登出后以游客身份浏览公开
 * 内容不在此拦截范围内（公开站点的固有限制，已与产品确认走账号封锁这一档）。
 */
export default function BannedScreen({ reason }: { reason?: string }) {
  const { signOut } = useSimpleAuth()

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(5,5,7,0.96)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          textAlign: "center",
          border: "1px solid rgba(248,113,113,0.35)",
          borderRadius: 16,
          background: "linear-gradient(180deg, rgba(30,10,12,0.9), rgba(12,12,14,0.9))",
          padding: "32px 24px",
          fontFamily: "monospace",
          color: "#fca5a5",
        }}
      >
        <Ban style={{ width: 40, height: 40, margin: "0 auto 16px", display: "block" }} />
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fecaca", margin: "0 0 8px" }}>
          你已被封禁
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: "#f5a3a3", margin: "0 0 4px" }}>
          你的账号已被管理员封禁，无法使用本站功能。
        </p>
        {reason ? (
          <p style={{ fontSize: 13, color: "#d98c8c", margin: "8px 0 0" }}>
            原因：{reason}
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => signOut()}
          style={{
            marginTop: 24,
            padding: "10px 20px",
            borderRadius: 10,
            border: "1px solid rgba(248,113,113,0.4)",
            background: "rgba(127,29,29,0.35)",
            color: "#fecaca",
            fontFamily: "monospace",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          退出登录
        </button>
      </div>
    </div>
  )
}
