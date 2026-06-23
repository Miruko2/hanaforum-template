"use client"

// 绝区零风「抠像进度条」：发帖现抠主体遮罩(lib/anime-matte generateMatte)时显示。
// 黑底荧光绿 + 倾斜机能感 + 斜向危险条纹滚动 + 大号斜体百分比 + 中英混排阶段标。
// determinate(wasm/model 下载，有字节进度) → 实时百分比；其余阶段(引擎/初始化/推理，
// 无字节进度) → 不定态荧光段扫掠。样式关键帧见 app/globals.css 的 .zzz-* 区块。

// 阶段 → 中英标。键与 lib/anime-matte 的 MattePhase 对应。
const PHASE_LABELS: Record<string, { cn: string; en: string }> = {
  engine: { cn: "准备引擎", en: "ENGINE" },
  wasm: { cn: "加载运行时", en: "RUNTIME" },
  model: { cn: "下载抠像模型", en: "MODEL" },
  init: { cn: "初始化", en: "INIT" },
  infer: { cn: "抠出主体", en: "MATTE" },
}

export default function MatteProgress({
  phase,
  pct,
}: {
  phase: string
  /** 0~100 有进度；null = 不定态(扫掠) */
  pct: number | null
}) {
  const label = PHASE_LABELS[phase] ?? { cn: "处理中", en: "WORK" }
  const determinate = pct !== null

  return (
    <div className="mt-2 select-none">
      {/* 阶段标 + 百分比 */}
      <div className="mb-1 flex items-end justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-black leading-none text-lime-400">»</span>
          <span className="text-[13px] font-bold tracking-wide text-white/90">{label.cn}</span>
          <span className="text-[10px] font-bold tracking-[0.25em] text-lime-400/60">{label.en}</span>
        </div>
        <span
          className="font-mono text-base font-black italic tabular-nums text-lime-400"
          style={{ textShadow: "0 0 10px rgba(163,230,53,0.55)" }}
        >
          {determinate ? `${pct}%` : <span className="zzz-dots">···</span>}
        </span>
      </div>

      {/* 倾斜轨道（机能感） */}
      <div
        className="relative h-4 overflow-hidden border border-lime-400/40 bg-black/70"
        style={{
          transform: "skewX(-12deg)",
          boxShadow: "0 0 12px rgba(163,230,53,0.15), inset 0 0 8px rgba(0,0,0,0.6)",
        }}
      >
        {/* 轨道底纹：极淡静态危险条纹 */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "repeating-linear-gradient(45deg, #a3e635 0 6px, transparent 6px 12px)",
          }}
        />

        {determinate ? (
          <>
            {/* 推进填充：荧光渐变 + 滚动条纹 */}
            <div
              className="absolute inset-y-0 left-0 overflow-hidden bg-gradient-to-r from-lime-500 to-lime-300 transition-[width] duration-200 ease-out"
              style={{ width: `${pct}%` }}
            >
              <div className="zzz-stripes-layer" />
            </div>
            {/* 亮缘：荧光推进的能量边（独立于填充，发光不被裁切） */}
            <div
              className="absolute inset-y-0 w-[2px] bg-white transition-[left] duration-200 ease-out"
              style={{
                left: `calc(${pct}% - 1px)`,
                boxShadow: "0 0 8px 2px rgba(255,255,255,0.85)",
              }}
            />
          </>
        ) : (
          // 不定态：一段荧光绿来回扫掠
          <div className="zzz-sweep absolute inset-y-0 left-0 w-2/5 overflow-hidden bg-gradient-to-r from-lime-500 to-lime-300">
            <div className="zzz-stripes-layer" />
          </div>
        )}
      </div>
    </div>
  )
}
