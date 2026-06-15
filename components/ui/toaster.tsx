"use client"

import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

// 绝区零风通知条样式（全站只注入一次）：深色切角面板 + 左侧霓虹状态竖条 + 状态色辉光。
// 配色/切角呼应邮箱验证弹窗（evg）。default=绿(成功/信息) destructive=红(错误)。
const TOAST_CSS = `
.zt-toast{
  position:relative; overflow:hidden; box-sizing:border-box;
  width:100%; padding:13px 34px 14px 20px; border-radius:2px;
  background:linear-gradient(150deg, rgba(28,30,34,0.985), rgba(13,14,17,0.99));
  color:#e8eaed;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,0.06);
  clip-path:polygon(0 0, calc(100% - 13px) 0, 100% 13px, 100% 100%, 0 100%);
  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
}
.zt-toast::before{
  content:""; position:absolute; left:0; top:0; bottom:0; width:4px;
  background:var(--zt-acc); box-shadow:0 0 11px 0 var(--zt-acc);
}
.zt-default{ --zt-acc:#2ee36b;
  filter:drop-shadow(0 10px 24px rgba(0,0,0,0.5)) drop-shadow(0 0 12px rgba(46,227,107,0.20)); }
.zt-destructive{ --zt-acc:#ff5252;
  filter:drop-shadow(0 10px 24px rgba(0,0,0,0.5)) drop-shadow(0 0 13px rgba(255,82,82,0.26)); }
.zt-title{ font-size:14px; font-weight:800; letter-spacing:.02em; color:#f3f5f7; line-height:1.35; }
.zt-desc{ font-size:12.5px; line-height:1.55; color:#a8b0b8; }
.zt-close{ color:rgba(255,255,255,0.4); }
.zt-close:hover{ color:#fff; }
.zt-action{
  display:inline-flex; align-items:center; height:30px; padding:0 13px;
  background:var(--zt-acc); color:#06140c; font-size:12.5px; font-weight:800;
  border:none; cursor:pointer;
  clip-path:polygon(0 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%);
}
.zt-action:hover{ filter:brightness(1.08); }
`

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      <style>{TOAST_CSS}</style>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
