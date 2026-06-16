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

// 背景镂空文字流（两派斜向交错、缓慢流动），呼应邮箱验证弹窗(evg)的卡内文字。
// 两份相同内容拼接 + translateX -50% → 无缝循环；上行往左上、下行往右下。
const ZT_TICK_A = "HANAKO · 萤火虫之国 · NOTICE · SYSTEM · ACCESS · 通知 · "
const ZT_TICK_B = "SYSTEM · 通知 · HANAKO · NOTICE · 萤火虫之国 · ACCESS · "

// 绝区零风通知条样式（全站只注入一次）：深色切角面板 + 左侧霓虹状态竖条 + 状态色辉光
// + 背景镂空斜向文字流。default=绿(成功/信息) destructive=红(错误)。
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
  content:""; position:absolute; left:0; top:0; bottom:0; width:4px; z-index:2;
  background:var(--zt-acc); box-shadow:0 0 11px 0 var(--zt-acc);
}
/* 背景镂空文字流：两行斜向、缓慢、互相反向 */
.zt-ticker{ position:absolute; inset:0; overflow:hidden; pointer-events:none; z-index:0; }
.zt-tick{ position:absolute; left:-50%; right:-50%; top:50%; transform:rotate(13deg); }
.zt-tick-1{ margin-top:-40px; }
.zt-tick-2{ margin-top:4px; }
.zt-tick-row{
  display:inline-block; white-space:nowrap; line-height:1;
  font-size:38px; font-weight:900; font-style:italic; letter-spacing:.05em;
  color:transparent; -webkit-text-stroke:1.5px rgba(255,255,255,0.1);
  will-change:transform;
}
.zt-tick-1 .zt-tick-row{ animation:zt-tickL 42s linear infinite; }
.zt-tick-2 .zt-tick-row{ animation:zt-tickR 48s linear infinite; }
/* 内容压在文字流之上 */
.zt-toast > .zt-body, .zt-toast > .zt-action, .zt-toast > .zt-close{ position:relative; z-index:1; }
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
@keyframes zt-tickL{ from{transform:translateX(0)} to{transform:translateX(-50%)} }
@keyframes zt-tickR{ from{transform:translateX(-50%)} to{transform:translateX(0)} }
@media (prefers-reduced-motion: reduce){
  .zt-tick-row{ animation:none; }
}
`

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      <style>{TOAST_CSS}</style>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <span className="zt-ticker" aria-hidden>
              <span className="zt-tick zt-tick-1">
                <span className="zt-tick-row">{ZT_TICK_A + ZT_TICK_A}</span>
              </span>
              <span className="zt-tick zt-tick-2">
                <span className="zt-tick-row">{ZT_TICK_B + ZT_TICK_B}</span>
              </span>
            </span>
            <div className="zt-body grid gap-1">
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
