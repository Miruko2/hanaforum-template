"use client"

// 点阵输入框：保留验证码弹窗那套 5×7 绿色 LED 点阵字符显示，外壳为站点一致的毛玻璃风。
// 真实文字透明、下层点阵实时显示所打字符；空时显示暗淡占位词、一打字点亮。
// 邮箱/用户名可在框下显示一行明文小字（防打错）；密码默认打码成「●」灯珠 + 眼睛开关显隐。
// 样式见 app/globals.css 的 .dmx-* 区块；字模见 lib/dot-matrix-glyphs.ts。

import { useId, useState, type ReactNode } from "react"
import { Eye, EyeOff } from "lucide-react"
import { getGlyph } from "@/lib/dot-matrix-glyphs"
import { cdnUrl } from "@/lib/cdn-url"

// 单个 5×7 点阵格（35 颗珠）。dim=占位暗淡态；active=末位闪烁「光标格」。
function DotCell({ ch, dim, active }: { ch?: string; dim?: boolean; active?: boolean }) {
  const rows = active ? null : getGlyph(ch || "")
  return (
    <span className={`dmx-cell${dim ? " is-dim" : ""}${active ? " is-active" : ""}`}>
      {Array.from({ length: 35 }).map((_, k) => {
        const on = rows ? rows[Math.floor(k / 5)][k % 5] === "1" : false
        return <span key={k} className={on ? "on" : undefined} />
      })}
    </span>
  )
}

interface DotMatrixInputProps {
  label: string
  value: string
  onChange: (v: string) => void
  type?: "text" | "email" | "password"
  /** 空值时显示的暗淡点阵占位词（拉丁/数字），如 "MAIL" / "USER" / "PASS" */
  placeholderWord: string
  autoComplete?: string
  inputMode?: "text" | "email" | "numeric"
  autoFocus?: boolean
  /** 邮箱/用户名传 true：框下显示一行明文小字，防打错；密码不传（保密） */
  showCaption?: boolean
  /** 标签行右侧附加节点，如登录页的「忘记密码?」链接 */
  labelExtra?: ReactNode
  /** 命中本机登录过的账号时传入：点阵显示替换为该账号头像（「欢迎回来」） */
  avatarUrl?: string | null
  /** 头像旁显示的用户名（可选） */
  avatarAlt?: string
}

// 单行可见的点阵窗口长度。超出部分像终端一样只显示尾部（真实值始终完整存在于 input）。
const MAX_CELLS = 12

/** 点阵输入框：真实 input 透明覆盖捕获键盘，下层点阵显示字符。 */
export function DotMatrixInput({
  label,
  value,
  onChange,
  type = "text",
  placeholderWord,
  autoComplete,
  inputMode,
  autoFocus,
  showCaption,
  labelExtra,
  avatarUrl,
  avatarAlt,
}: DotMatrixInputProps) {
  const id = useId()
  const [focused, setFocused] = useState(false)
  const [reveal, setReveal] = useState(false)
  const isPassword = type === "password"

  const shown = value.slice(-MAX_CELLS).split("")

  return (
    <div className="dmx-field">
      <div className="dmx-labelrow">
        <label htmlFor={id} className="dmx-label">
          {label}
        </label>
        {labelExtra}
      </div>

      <div className={`dmx-box${focused ? " is-focus" : ""}`}>
        <input
          id={id}
          className={`dmx-input${isPassword ? " has-eye" : ""}`}
          // 密码恒为 type=password（保密 + 密码管理器识别）；显隐只切换下层点阵字模
          type={isPassword ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode={inputMode}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          required
          aria-label={label}
        />

        {avatarUrl ? (
          // 命中本机账号：点阵字符替换为该账号头像（「欢迎回来」）。input 仍在上层透明覆盖，可继续编辑；
          // 一旦改动导致邮箱不再匹配，父级会清空 avatarUrl、自动切回点阵。
          <div className="dmx-avatar" aria-hidden>
            {/* 原生 img 直连（项目已弃用 Vercel 图片优化以避免 egress 爆额，头像各处同此） */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="dmx-avatar-img" src={cdnUrl(avatarUrl) ?? avatarUrl} alt="" loading="lazy" />
            {avatarAlt ? <span className="dmx-welcome">{avatarAlt}</span> : null}
          </div>
        ) : (
          <div className="dmx-dm" aria-hidden>
            <div className={`dmx-track${value ? "" : " is-empty"}`}>
              {value
                ? shown.map((ch, i) => <DotCell key={i} ch={isPassword && !reveal ? "•" : ch} />)
                : placeholderWord.split("").map((ch, i) => <DotCell key={i} ch={ch} dim />)}
              {focused && <DotCell key="active" active />}
            </div>
          </div>
        )}

        {isPassword && (
          <button
            type="button"
            className="dmx-eye"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "隐藏密码" : "显示密码"}
            aria-pressed={reveal}
          >
            {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>

      {showCaption && (
        <span className="dmx-cap" aria-hidden>
          {value || " "}
        </span>
      )}
    </div>
  )
}
