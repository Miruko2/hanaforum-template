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

// 全站通知条样式（全站只注入一次）。
//
// 设计语言 = 「论坛毛玻璃」×「二次元游戏转场元素」的融合：
//  · 主体沿用 GlassMorph / .mp-banner 的毛玻璃语言（backdrop-filter blur 半透明深底 +
//    玻璃上沿高光、内描边、轻投影），保证和论坛其它面板（帖子卡、导航栏、个人页横幅）同源；
//  · 叠加 .ptr-* 转场那套游戏 MG 细节作为「点睛」而非「主体」：右上角切角 clip-path
//    （科技感斜切）、左侧状态色 hazard 斜纹条、右侧描边镂空巨字水印（OK/ERR 印章）、
//    贴纸式硬投影斜体标题、一次性高光扫掠、左上状态色角标编号。
//  · default=lime(成功/信息) destructive=red(错误)：两套 CSS 变量切色。
//  · 动效仅入场一次（裁切滑入 + hazard 纵向拉开 + 高光扫掠 + 水印漂移），
//    无位移类常驻无限动画 —— 与 .mp-banner 同思路，安卓 WebView 安全。
//    退场交给 Radix 的 swipe / fade（toast.tsx 里 data-[state=closed] 的变体）。
//
// 说明：毛玻璃在面板背后是纯色/暗化背景时仍成立（站点底图是 mos-background，
// 多数页面顶部还压一层卡片/列表，被模糊后正是毛玻璃想要的「柔焦底」）。
const TOAST_CSS = `
.zt-toast{
  position:relative; overflow:hidden; box-sizing:border-box;
  width:100%; padding:13px 34px 13px 22px;
  /* 毛玻璃底：半透明深色 + backdrop-blur。实色兜底在下方 .zt-android 覆盖。 */
  background:rgba(28,28,36,0.55);
  backdrop-filter:blur(22px) saturate(140%);
  -webkit-backdrop-filter:blur(22px) saturate(140%);
  color:#e8eaed;
  border:1px solid rgba(255,255,255,0.12);
  border-radius:16px;
  /* 右上科技切角（左上保留圆角放状态条） */
  clip-path:polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%);
  box-shadow:
    0 12px 34px rgba(0,0,0,0.42),
    0 0 22px var(--zt-glow),
    inset 0 1px 0 rgba(255,255,255,0.10);
  font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
}
/* 玻璃上沿高光线（与 .mp-banner::before 同款反光） */
.zt-toast::before{
  content:""; position:absolute; top:0; left:9%; right:9%; height:1px; z-index:4; pointer-events:none;
  background:linear-gradient(90deg, transparent, rgba(255,255,255,0.34), transparent);
}
/* 半调网点叠层（呼应 .ptr-halftone 的胶片质感，极淡、不抢内容） */
.zt-halftone{
  position:absolute; inset:0; z-index:0; pointer-events:none; opacity:0.5;
  background-image:radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1.2px);
  background-size:14px 14px;
}
/* 左侧 hazard 斜纹条（状态色，纵向拉开入场） */
.zt-hazard{
  position:absolute; left:0; top:0; bottom:0; width:5px; z-index:2; pointer-events:none;
  background:repeating-linear-gradient(45deg, var(--zt-acc) 0, var(--zt-acc) 5px, transparent 5px, transparent 10px);
  box-shadow:0 0 10px 0 var(--zt-glow);
  transform-origin:top center;
  animation:zt-hazard-in 0.5s cubic-bezier(0.2,1,0.3,1) 0.18s both;
}
@keyframes zt-hazard-in{ from{ opacity:0; transform:scaleY(0);} to{ opacity:1; transform:scaleY(1);} }
/* 右侧描边镂空巨字水印（状态印章 OK / ERR） */
.zt-wm{
  position:absolute; right:8px; top:50%; transform:translateY(-50%); z-index:0;
  font-size:2.6rem; font-weight:900; font-style:italic; line-height:1; letter-spacing:-0.04em;
  color:transparent; -webkit-text-stroke:1.5px var(--zt-wm-stroke);
  user-select:none; pointer-events:none;
  animation:zt-wm-in 0.7s cubic-bezier(0.23,1,0.32,1) 0.1s both;
}
@keyframes zt-wm-in{ from{ opacity:0; transform:translateY(-50%) translateX(14px);} to{ opacity:1; transform:translateY(-50%) translateX(0);} }
/* 一次性高光扫掠 */
.zt-sheen{
  position:absolute; inset:0; z-index:1; pointer-events:none;
  background:linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.13) 50%, transparent 60%);
  transform:translateX(-130%);
  animation:zt-sheen-sweep 1.05s cubic-bezier(0.4,0,0.2,1) 0.12s both;
}
@keyframes zt-sheen-sweep{ to{ transform:translateX(130%); } }
/* 左上状态色角标编号（呼应 .ptr-corner-no 的角标语言） */
.zt-tag{
  position:absolute; left:14px; top:-1px; z-index:3; display:inline-flex; align-items:center;
  height:16px; padding:0 7px; font-size:9px; font-weight:800; letter-spacing:0.22em;
  color:#0a1207; background:var(--zt-acc);
  clip-path:polygon(0 0,100% 0,100% 100%,8px 100%,0 calc(100% - 6px));
  animation:zt-fade-in 0.3s ease-out 0.3s both;
}
@keyframes zt-fade-in{ from{opacity:0;} to{opacity:1;} }
/* 内容压在装饰之上 */
.zt-toast > .zt-body, .zt-toast > .zt-action, .zt-toast > .zt-close{ position:relative; z-index:3; }
/* 状态色变量：default=lime(成功/信息) destructive=red(错误) */
.zt-default{ --zt-acc:#a3e635; --zt-glow:rgba(163,230,53,0.30); --zt-wm-stroke:rgba(163,230,53,0.20); }
.zt-destructive{ --zt-acc:#ff4d4d; --zt-glow:rgba(255,77,77,0.34); --zt-wm-stroke:rgba(255,77,77,0.24); }
/* 标题：贴纸式硬投影（状态色双层）+ 从左裁切滑入 */
.zt-title{
  position:relative; font-size:14.5px; font-weight:800; letter-spacing:.01em; color:#fff;
  text-shadow:0.03em 0.03em 0 var(--zt-acc), 0.06em 0.06em 0 rgba(0,0,0,0.45);
  line-height:1.3;
  animation:zt-title-in 0.5s cubic-bezier(0.2,0.7,0.3,1) 0.14s both;
}
@keyframes zt-title-in{
  from{ opacity:0; transform:translateX(-12px); clip-path:inset(0 100% 0 0); }
  to{ opacity:1; transform:translateX(0); clip-path:inset(0 0 0 0); }
}
.zt-desc{
  font-size:12.5px; line-height:1.55; color:#b8c0c8; margin-top:4px;
  animation:zt-fade-in 0.45s ease-out 0.3s both;
}
.zt-close{ color:rgba(255,255,255,0.42); }
.zt-close:hover{ color:#fff; }
.zt-action{
  display:inline-flex; align-items:center; height:28px; padding:0 13px;
  background:var(--zt-acc); color:#0a1207; font-size:12.5px; font-weight:800; border:none; cursor:pointer;
  clip-path:polygon(0 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%);
}
.zt-action:hover{ filter:brightness(1.08); }
/* 弱合成器（安卓 WebView 等）：去 backdrop-filter，改近实底深色底。
   观感与毛玻璃几乎一致（站点底图本就偏暗），换掉「每帧重采样背景」省合成开销。 */
.zt-android{
  background:rgba(26,26,34,0.93);
  backdrop-filter:none; -webkit-backdrop-filter:none;
}
@media (prefers-reduced-motion: reduce){
  .zt-hazard,.zt-wm,.zt-sheen,.zt-tag,.zt-title,.zt-desc{ animation:none; }
  .zt-sheen{ display:none; }
  .zt-title{ clip-path:none; }
  .zt-hazard{ transform:scaleY(1); }
  .zt-wm{ transform:translateY(-50%); }
}
`

// 安卓等弱合成器环境判定：驱动是否走实底变体（去 backdrop-filter）。
// SSR 首帧为 false（默认毛玻璃），客户端挂载后修正 —— toast 多为客户端交互触发，
// 真正弹出时此值已就位。
function useIsAndroidLike(): boolean {
  if (typeof navigator === "undefined") return false
  return /android/i.test(navigator.userAgent)
}

export function Toaster() {
  const { toasts } = useToast()
  const isAndroidLike = useIsAndroidLike()

  return (
    // 自动消失由 use-toast.ts 的显式计时器驱动（4s）——不靠 Radix 的 duration 计时器，
    // 因为它在窗口失焦/悬停时会暂停，安卓 WebView 里会被永久卡住、永不消失。
    // 这里仍保留 duration={4000} 作冗余兜底（桌面有焦点时也会触发，时长一致）。
    // 仍可手动点 ✕ 关闭。
    <ToastProvider duration={4000}>
      <style>{TOAST_CSS}</style>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        const isErr = variant === "destructive"
        const wm = isErr ? "ERR" : "OK"
        const tag = isErr ? "ERROR" : "INFO"
        return (
          <Toast
            key={id}
            variant={variant}
            // 安卓叠加实底类去 backdrop-filter；由 Toast 合并 className
            className={isAndroidLike ? "zt-android" : undefined}
            {...props}
          >
            <span className="zt-halftone" aria-hidden />
            <span className="zt-hazard" aria-hidden />
            <span className="zt-wm" aria-hidden>{wm}</span>
            <span className="zt-sheen" aria-hidden />
            <span className="zt-tag" aria-hidden>{tag}</span>
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
