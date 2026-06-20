// 动漫主体抠像（生成「深度遮罩」），供发帖时在浏览器现抠。
// 模型 isnet-anime（skytnt/anime-seg）经 onnxruntime-web 在 Web Worker 里跑（CPU/wasm）。
// 引擎与 wasm 同源放在 /ort/（见 public/ort/，由 npmmirror 下载）；模型从 HuggingFace 拉
// （约 176MB，首次后浏览器缓存）。整套都在 worker 后台线程，主线程不卡。
//
// 为什么这么绕（不直接 importScripts CDN）：实测该环境下 worker 里跨域 importScripts、
// 以及 npmmirror 的 MIME 都不被接受 → 改为主线程 fetch 同源 /ort/，再把引擎代码内联进
// worker 源码。WebGPU 后端跑不了本模型（MaxPool ceil_mode 不支持）故固定走 wasm/CPU。

const ORT_JS = "/ort/ort.webgpu.min.js"
const ORT_WASM = "/ort/ort-wasm-simd-threaded.jsep.wasm"
const ORT_BASE = "/ort/"
const MODEL_URL = "https://huggingface.co/skytnt/anime-seg/resolve/main/isnetis.onnx"
const MASK_MAX_EDGE = 1024 // 遮罩是平滑深度图，封到 1024 足够、PNG 体积小

export type MattePhase = "engine" | "wasm" | "model" | "init" | "infer"
export type MatteProgress = (phase: MattePhase, loaded: number, total: number) => void

// worker 逻辑（引擎代码在主线程 fetch 后拼到它前面，运行时 self.ort 已就绪）。
const WORKER_LOGIC = [
  "var session=null;",
  "self.onmessage=async (e)=>{ var m=e.data; try{",
  "  if(m.type==='init'){ var ort=self.ort;",
  "    if(!ort) throw new Error('ORT inline failed: self.ort empty');",
  "    try{ ort.env.wasm.wasmBinary=m.wasm; }catch(e2){}",
  "    ort.env.wasm.wasmPaths=m.ortBase;",
  "    ort.env.wasm.numThreads=1;",
  "    session=await ort.InferenceSession.create(new Uint8Array(m.model),{executionProviders:['wasm']});",
  "    self.postMessage({type:'ready'}); }",
  "  else if(m.type==='run'){ var o=self.ort; var t=new o.Tensor('float32',m.data,[1,3,1024,1024]);",
  "    var out=await session.run({img:t}); var arr=out[session.outputNames[0]].data;",
  "    self.postMessage({type:'result',data:arr},[arr.buffer]); }",
  "}catch(err){ self.postMessage({type:'error',error:(err&&err.message)||String(err)}); } };",
].join("\n")

let segWorker: Worker | null = null
let segReady = false
let pending: { resolve: (v: any) => void; reject: (e: any) => void } | null = null

async function fetchBuf(url: string, onP?: (l: number, t: number) => void): Promise<Uint8Array> {
  const r = await fetch(url)
  if (!r.ok || !r.body) throw new Error(url + " HTTP " + r.status)
  const total = +(r.headers.get("content-length") || 0)
  const reader = r.body.getReader()
  let got = 0
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) { chunks.push(value); got += value.length; onP && onP(got, total) }
  }
  const out = new Uint8Array(got)
  let p = 0
  for (const c of chunks) { out.set(c, p); p += c.length }
  return out
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(url + " HTTP " + r.status)
  return await r.text()
}

function ensureWorker(ortCode: string) {
  if (segWorker) return
  const src = ortCode + "\n;\n" + WORKER_LOGIC
  segWorker = new Worker(URL.createObjectURL(new Blob([src], { type: "application/javascript" })))
  segWorker.onmessage = (e: MessageEvent) => {
    const job = pending
    pending = null
    if (!job) return
    if (e.data.type === "error") job.reject(new Error(e.data.error))
    else job.resolve(e.data)
  }
  segWorker.onerror = (e: ErrorEvent) => {
    const job = pending
    pending = null
    if (job) job.reject(new Error(e.message || "matte worker error"))
  }
}

function call(msg: any, transfer?: Transferable[]): Promise<any> {
  return new Promise((resolve, reject) => {
    pending = { resolve, reject }
    segWorker!.postMessage(msg, transfer || [])
  })
}

async function ensureSession(onP?: MatteProgress) {
  if (segReady) return
  const origin = typeof location !== "undefined" ? location.origin : ""
  onP && onP("engine", 0, 0)
  const ortCode = await fetchText(ORT_JS)
  const wasm = await fetchBuf(ORT_WASM, (l, t) => onP && onP("wasm", l, t))
  const model = await fetchBuf(MODEL_URL, (l, t) => onP && onP("model", l, t))
  ensureWorker(ortCode)
  onP && onP("init", 0, 0)
  await call({ type: "init", model: model.buffer, wasm: wasm.buffer, ortBase: origin + ORT_BASE }, [
    model.buffer,
    wasm.buffer,
  ])
  segReady = true
}

export function isMatteSupported(): boolean {
  return typeof window !== "undefined" && typeof Worker !== "undefined" && typeof WebAssembly !== "undefined"
}

// 生成主体遮罩：返回灰度 canvas（主体≈白、背景≈黑），最长边封到 MASK_MAX_EDGE。
export async function generateMatte(
  img: HTMLImageElement | HTMLCanvasElement,
  onProgress?: MatteProgress,
): Promise<HTMLCanvasElement> {
  await ensureSession(onProgress)
  const S = 1024
  const w0 = (img as HTMLImageElement).naturalWidth || img.width
  const h0 = (img as HTMLImageElement).naturalHeight || img.height
  // 保比例居中、黑边填充到 1024×1024（与 isnet-anime 预处理一致）
  const k = S / Math.max(w0, h0)
  const dw = Math.round(w0 * k), dh = Math.round(h0 * k)
  const ox = Math.floor((S - dw) / 2), oy = Math.floor((S - dh) / 2)
  const c = document.createElement("canvas"); c.width = S; c.height = S
  const cx = c.getContext("2d")!
  cx.fillStyle = "#000"; cx.fillRect(0, 0, S, S)
  cx.drawImage(img, ox, oy, dw, dh)
  const data = cx.getImageData(0, 0, S, S).data
  const plane = S * S
  const chw = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    chw[i] = data[i * 4] / 255
    chw[plane + i] = data[i * 4 + 1] / 255
    chw[2 * plane + i] = data[i * 4 + 2] / 255
  }
  onProgress && onProgress("infer", 0, 0)
  const res = await call({ type: "run", data: chw }, [chw.buffer])
  const mask: Float32Array = res.data
  let mn = Infinity, mx = -Infinity
  for (let i = 0; i < mask.length; i++) { const v = mask[i]; if (v < mn) mn = v; if (v > mx) mx = v }
  const rng = (mx - mn) || 1
  // 1024 灰度（主体白/背景黑）
  const mc = document.createElement("canvas"); mc.width = S; mc.height = S
  const mctx = mc.getContext("2d")!
  const mi = mctx.createImageData(S, S)
  for (let i = 0; i < plane; i++) {
    const v = Math.round(((mask[i] - mn) / rng) * 255)
    mi.data[i * 4] = v; mi.data[i * 4 + 1] = v; mi.data[i * 4 + 2] = v; mi.data[i * 4 + 3] = 255
  }
  mctx.putImageData(mi, 0, 0)
  // 去黑边裁回原比例，最长边封到 MASK_MAX_EDGE
  const oScale = Math.min(1, MASK_MAX_EDGE / Math.max(w0, h0))
  const outW = Math.max(1, Math.round(w0 * oScale)), outH = Math.max(1, Math.round(h0 * oScale))
  const out = document.createElement("canvas"); out.width = outW; out.height = outH
  out.getContext("2d")!.drawImage(mc, ox, oy, dw, dh, 0, 0, outW, outH)
  return out
}

// 把遮罩 canvas 导出为 webp blob（有损 0.85）。遮罩是平滑深度图、渲染端还会再羽化，
// 有损 webp 画质无感损失，体积比无损 PNG 小一个数量级（省存储/egress）。
// 现代桌面浏览器 canvas 均支持 webp 编码；发帖抠像开关本就桌面专属，故不做 png 回退
//（极端不支持时 toBlob 会回退 png 字节，<img>/Image() 按内容嗅探仍能解码，不至于崩）。
export function matteToWebpBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/webp", 0.85)
  })
}
