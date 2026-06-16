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

// 绝区零式通知条样式（全站只注入一次）。设计语言对齐个人页「我的帖子」标题条(.mp-*)：
// 实心暗底 + 状态色辉光、左侧 hazard 斜纹、右侧描边镂空巨字水印(状态印章)、
// 贴纸式硬投影斜体标题、一次性高光扫掠、顶边高光线。
// default=lime(成功/信息) destructive=red(错误)。动效仅入场扫掠一次，无常驻位移动画。
const TOAST_CSS = `
.zt-toast{
  position:relative; overflow:hidden; box-sizing:border-box;
  width:100%; padding:14px 30px 15px 24px;
  background:linear-gradient(150deg, rgba(30,32,37,0.99), rgba(14,15,18,0.995));
  color:#e8eaed;
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.08), inset 0 0 0 1px rgba(255,255,255,0.05);
  clip-path:polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
}
/* 顶边高光线（玻璃上沿反光） */
.zt-toast::before{
  content:""; position:absolute; top:0; left:9%; right:9%; height:1px; z-index:4; pointer-events:none;
  background:linear-gradient(90deg, transparent, rgba(255,255,255,0.32), transparent);
}
/* 左侧 hazard 斜纹条（状态色） */
.zt-hazard{
  position:absolute; left:0; top:0; bottom:0; width:6px; z-index:2; pointer-events:none;
  background:repeating-linear-gradient(45deg, var(--zt-acc) 0, var(--zt-acc) 5px, transparent 5px, transparent 10px);
  box-shadow:0 0 10px 0 var(--zt-glow);
}
/* 右侧描边镂空巨字水印（状态印章） */
.zt-wm{
  position:absolute; right:-3px; top:50%; transform:translateY(-50%); z-index:0;
  font-size:3.5rem; font-weight:900; font-style:italic; line-height:1; letter-spacing:-0.04em;
  color:transparent; -webkit-text-stroke:1.5px var(--zt-wm-stroke);
  user-select:none; pointer-events:none;
}
/* 一次性高光扫掠 */
.zt-sheen{
  position:absolute; inset:0; z-index:1; pointer-events:none;
  background:linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%);
  transform:translateX(-130%);
  animation:zt-sheen-sweep 1.05s cubic-bezier(0.4,0,0.2,1) 0.12s both;
}
@keyframes zt-sheen-sweep{ to{ transform:translateX(130%); } }
/* 内容压在装饰之上 */
.zt-toast > .zt-body, .zt-toast > .zt-action, .zt-toast > .zt-close{ position:relative; z-index:3; }
.zt-default{ --zt-acc:#a3e635; --zt-glow:rgba(163,230,53,0.55); --zt-wm-stroke:rgba(163,230,53,0.17);
  --zt-sh1:rgba(163,230,53,0.85); --zt-sh2:rgba(163,230,53,0.3);
  filter:drop-shadow(0 10px 24px rgba(0,0,0,0.5)) drop-shadow(0 0 13px rgba(163,230,53,0.15)); }
.zt-destructive{ --zt-acc:#ff5252; --zt-glow:rgba(255,82,82,0.6); --zt-wm-stroke:rgba(255,82,82,0.2);
  --zt-sh1:rgba(255,82,82,0.85); --zt-sh2:rgba(255,82,82,0.3);
  filter:drop-shadow(0 10px 24px rgba(0,0,0,0.5)) drop-shadow(0 0 13px rgba(255,82,82,0.22)); }
.zt-title{ font-size:14.5px; font-weight:900; font-style:italic; letter-spacing:.01em; color:#fff;
  text-shadow:0.03em 0.03em 0 var(--zt-sh1), 0.06em 0.06em 0 var(--zt-sh2); line-height:1.3; }
.zt-desc{ font-size:12.5px; line-height:1.55; color:#aab2ba; margin-top:3px; }
.zt-close{ color:rgba(255,255,255,0.4); }
.zt-close:hover{ color:#fff; }
.zt-action{
  display:inline-flex; align-items:center; height:30px; padding:0 13px;
  background:var(--zt-acc); color:#0a1207; font-size:12.5px; font-weight:800; border:none; cursor:pointer;
  clip-path:polygon(0 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%);
}
.zt-action:hover{ filter:brightness(1.08); }
@media (prefers-reduced-motion: reduce){
  .zt-sheen{ display:none; }
}
`

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      <style>{TOAST_CSS}</style>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const wm = variant === "destructive" ? "ERR" : "OK"
        return (
          <Toast key={id} variant={variant} {...props}>
            <span className="zt-hazard" aria-hidden />
            <span className="zt-wm" aria-hidden>{wm}</span>
            <span className="zt-sheen" aria-hidden />
            <div className="zt-body">
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
