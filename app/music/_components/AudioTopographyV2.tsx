"use client"

import { useEffect, useRef } from "react"

/**
 * 音频地形波可视化器（详情页全屏背景，Three.js）—— 详情页「声波地形」模式（liquidFx==="topography"）。
 *
 * **移植自开源项目 yin-yizhen/sonic-topography 的着色器地形**，已正式取代初版 AudioTopography.tsx
 * （后者保留未挂载、可删）。本地歌开始播放时会自动默认切到本模式。
 *   - 整套视觉都在 GLSL 着色器里算（多频段各画不同地形图案、按高度的色板渐变、顶面描边发光、
 *     边缘渐隐成透明、顶面闪烁/火花、涟漪覆盖）——所以远比「基础材质逐方块上色」有质感。
 *   - 声音拆成 8 个频段 + 若干音色指标喂给 uniform；无声时也有海浪般底噪保持流动。
 *   - 配色用主题色板（当前粉白：玫粉→粉白发光，按音色冷暖在粉系内微移）。
 *   - 无后期 bloom（原作也没有，辉光全靠着色器加色），故只动态 import three 本体、首屏零成本。
 *
 * imperative Three.js（three@0.160 动态 import，切独立 chunk、不进 /music 首屏）。
 * 仅本地上传歌 + 桌面/iPad 挂载（在线歌无 FFT、调用方不挂载）。
 */
type Props = {
  getFrequencies: (out: Uint8Array) => boolean
  /** 当前主色相（0..360）。本可视化用主题色板，hue 暂不使用，保留以兼容调用方。 */
  hue: number
  playing: boolean
}

// 必须等于 PlaybackContext 里 analyser.frequencyBinCount（fftSize 512 → 256）。
const BINS = 256

// —— 网格（与原作同尺度，着色器里的距离常量按此调校，别随意改 GRID/SPACING）——
const GRID = 150 // 每边方块数（GRID²≈22500，桌面 GPU 可承受）
const SPACING = 1.05 // 单元间距
const CUBE_W = 0.9 // 方块横截面（留 0.15 缝＝棋盘感）

// —— 相机（绕中心缓慢自转的 3/4 俯视；想调角度改这几个）——
const CAM_FOV = 52
const ORBIT_RADIUS = 35 // 离中心水平距离（小＝更近）
const ORBIT_HEIGHT = 27 // 相机高度（大＝更俯视）
const LOOK_Y = 2 // 看向点的高度
const ORBIT_SPEED = 0.04 // 自转角速度（弧度/秒）

// —— 主题色板（粉白：暗底上玫粉→粉白发光地形；想回原作改回 Nocturnal 蓝紫即可）——
// 冷区/暖区都设成粉系，使无论音色冷暖整片都读作「粉→白」；涟漪取亮粉白波峰。
const THEME = {
  baseColor1: [0.04, 0.01, 0.03] as const, // 暗底：带粉的近黑，让发光更跳
  baseColor2: [0.1, 0.04, 0.08] as const, // 暗底2 / 雾色：深梅紫
  coolCore: [1.0, 0.35, 0.62] as const, // 冷区核：较浓玫粉
  coolEdge: [1.0, 0.78, 0.88] as const, // 冷区缘：接近白的浅粉
  warmCore: [1.0, 0.5, 0.6] as const, // 暖区核：偏珊瑚的粉
  warmEdge: [1.0, 0.88, 0.92] as const, // 暖区缘：粉白
  rippleColor: [1.0, 0.8, 0.92] as const, // 涟漪：亮粉白波峰
  glowIntensity: 1.0,
}

const VERT = /* glsl */ `
  uniform float uTime;

  uniform float uSubBass;
  uniform float uBass;
  uniform float uLowMid;
  uniform float uMid;
  uniform float uHighMid;

  uniform float uSmoothness;
  uniform float uDensity;
  uniform float uEnergy;

  struct Ripple {
    vec2 pos;
    float time;
    float strength;
    float isActive;
    float rippleType;
  };
  uniform Ripple uRipples[10];

  varying vec2 vUv;
  varying float vElevation;
  varying float vDistance;
  varying vec2 vRippleAnim;
  varying vec3 vNormal;
  varying float vRelativeY;
  varying vec2 vInstancePos;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187,  0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1; i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ; m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0; vec3 h = abs(x) - 0.5; vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox; m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g; g.x  = a0.x  * x0.x  + h.x  * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }

  void main() {
    vUv = uv;
    vNormal = normal;

    vec4 instancePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 pos2D = instancePos.xz;
    vInstancePos = pos2D;

    float centerDist = length(pos2D);
    vDistance = centerDist;

    float rnd = random(pos2D);

    // 1. Idle Background state (smooth, ocean-like)
    vec2 movingPos = pos2D * 0.05 + vec2(uTime * 0.1, uTime * 0.05);
    float baseNoise = (snoise(movingPos) + 1.0) * 0.5;
    float wave = sin(pos2D.x * 0.15 + pos2D.y * 0.1 - uTime * 0.6) * 0.5 + 0.5;

    float globalFalloff = smoothstep(60.0, 30.0, centerDist);
    float idleElevation = mix(baseNoise, wave, uSmoothness * 0.5 + 0.2) * 0.8 * globalFalloff;

    // 2. Frequency Regions & Displacements
    float subRegion = smoothstep(25.0, 0.0, centerDist);
    float subLift = uSubBass * subRegion * 5.0;

    float bassNoise = snoise(pos2D * 0.1 - vec2(0.0, uTime * 0.2));
    float bassRegion = smoothstep(35.0, 5.0, centerDist + bassNoise * 5.0);
    float bassLift = uBass * bassRegion * (smoothstep(0.0, 1.0, rnd + uDensity * 0.5)) * 4.0;

    float lowMidNoise = snoise(pos2D * 0.05 + vec2(uTime * 0.1, 0.0));
    float lowMidLift = uLowMid * (lowMidNoise * 0.5 + 0.5) * 2.5;

    float riverFlow = sin(pos2D.x * 0.2 + pos2D.y * 0.2 + snoise(pos2D * 0.1) * 2.0 - uTime * 2.0);
    float midLift = uMid * max(0.0, riverFlow) * 3.0;

    float highMidRegion = smoothstep(10.0, 45.0, centerDist);
    float highMidLift = 0.0;
    if (fract(rnd * 13.3) > 0.8) {
        highMidLift = uHighMid * highMidRegion * fract(rnd * 7.7) * 2.5;
    }

    float audioElevation = subLift + bassLift + lowMidLift + midLift + highMidLift;

    if (rnd > 0.99) {
        audioElevation += uEnergy * 5.0;
    }

    audioElevation *= globalFalloff;

    float elevation = idleElevation + audioElevation;

    // Ripples
    float rippleElevation = 0.0;
    float rippleIntensityNormal = 0.0;
    float rippleIntensityWhite = 0.0;
    float speed = 15.0;
    float width = 3.0;

    for(int i = 0; i < 10; i++) {
      if(uRipples[i].isActive > 0.0) {
         float dist = length(pos2D - uRipples[i].pos);
         float timeSince = uTime - uRipples[i].time;

         float curSpeed = speed;
         float curWidth = width;
         float curFadeDist = 15.0;
         float elevationScale = 4.0;

         if (uRipples[i].rippleType > 0.5) {
             curSpeed = 20.0;
             curWidth = 1.0;
             curFadeDist = 8.0;
             elevationScale = 1.0;
         }

         float waveRadius = timeSince * curSpeed;
         float d = dist - waveRadius;
         float rippleWave = exp(-d*d / curWidth);
         float fade = exp(-waveRadius / curFadeDist);
         float rPulse = rippleWave * fade * uRipples[i].strength;

         rippleElevation += rPulse * elevationScale;
         if (uRipples[i].rippleType > 0.5) {
             rippleIntensityWhite += rPulse;
         } else {
             rippleIntensityNormal += rPulse;
         }
      }
    }

    elevation += rippleElevation;
    vRippleAnim = vec2(clamp(rippleIntensityNormal, 0.0, 1.0), clamp(rippleIntensityWhite, 0.0, 1.0));
    vElevation = elevation;

    float yPos = position.y + 0.5;
    vRelativeY = yPos;

    float totalHeight = 1.0 + elevation;
    vec3 pos = position;
    pos.y = -0.5 + yPos * totalHeight;

    vec4 worldPosition = instanceMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`

const FRAG = /* glsl */ `
  uniform float uTime;

  uniform float uPresence;
  uniform float uBrilliance;
  uniform float uAir;

  uniform float uWarmth;
  uniform float uBrightness;
  uniform float uSharpness;

  uniform vec3 uBaseColor1;
  uniform vec3 uBaseColor2;
  uniform vec3 uCoolCore;
  uniform vec3 uCoolEdge;
  uniform vec3 uWarmCore;
  uniform vec3 uWarmEdge;
  uniform vec3 uRippleColor;
  uniform float uGlowIntensity;

  varying vec2 vUv;
  varying float vElevation;
  varying float vDistance;
  varying vec2 vRippleAnim;
  varying vec3 vNormal;
  varying float vRelativeY;
  varying vec2 vInstancePos;

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
  }

  void main() {
    bool isTop = vNormal.y > 0.5;
    float distFromTop = 1.0 - vRelativeY;

    float rnd = random(vInstancePos);
    float centerDist = length(vInstancePos);

    float normElevation = clamp(vElevation / 8.0, 0.0, 1.0);

    vec3 cBase1 = uBaseColor1;
    vec3 cBase2 = uBaseColor2;

    vec3 coolCore = uCoolCore;
    vec3 coolEdge = uCoolEdge;
    vec3 warmCore = uWarmCore;
    vec3 warmEdge = uWarmEdge;

    float warmBlend = smoothstep(0.0, 1.0, uWarmth * 1.5 + (0.5 - centerDist/80.0));

    vec3 zoneCore = mix(coolCore, warmCore, warmBlend);
    vec3 zoneEdge = mix(coolEdge, warmEdge, warmBlend);

    vec3 targetGlow = mix(zoneCore, zoneEdge, fract(rnd * 11.0));

    float distFade = 1.0 - smoothstep(40.0, 75.0, centerDist);

    targetGlow = mix(targetGlow, vec3(1.0, 0.92, 0.96), uBrightness * 0.6);

    vec3 currentGlow = mix(cBase2, targetGlow, normElevation) * uGlowIntensity * distFade;

    currentGlow = mix(currentGlow, uRippleColor, vRippleAnim.x);
    currentGlow = mix(currentGlow, vec3(1.0, 1.0, 1.0), vRippleAnim.y);

    vec3 bodyColor = mix(cBase1, cBase2, vRelativeY * distFade);
    vec3 finalColor;

    if (isTop) {
       float topIntensity = smoothstep(0.0, 0.4, normElevation);

       // 闪白随距离更早熄灭，且高方块也不再豁免：远处小方块上的纯白点正是「撕裂」来源。
       float twinkleDistFalloff = smoothstep(50.0, 18.0, centerDist);
       float twinkleMultiplier = twinkleDistFalloff * mix(0.5, 1.0, smoothstep(0.01, 0.1, normElevation));

       bool isSparkleTarget = fract(rnd * 31.0) > 0.95;
       if (isSparkleTarget && normElevation < 0.1) {
          topIntensity += uAir * 2.0 * twinkleMultiplier;
       }

       finalColor = mix(cBase2, currentGlow, topIntensity);

       float edgeX = smoothstep(0.05, 0.01, vUv.x) + smoothstep(0.95, 0.99, vUv.x);
       float edgeY = smoothstep(0.05, 0.01, vUv.y) + smoothstep(0.95, 0.99, vUv.y);
       float edge = min(edgeX + edgeY, 1.0);
       finalColor += currentGlow * edge * 0.8 * (topIntensity + 0.3);

       float flashChance = smoothstep(0.3, 1.0, uPresence);
       if (fract(rnd * 53.0) > 0.98 - flashChance * 0.1) {
           float flashSync = sin(uTime * 12.0 + rnd * 100.0) * 0.5 + 0.5;
           finalColor += mix(vec3(1.0), vec3(0.5, 1.0, 1.0), rnd) * flashSync * uPresence * (0.4 + uSharpness * 0.6) * twinkleMultiplier;
       }

       if (edge > 0.5 && fract(rnd * 89.0 + uTime * 0.7) > 0.98) {
           finalColor += vec3(1.0) * uBrilliance * 1.0 * twinkleMultiplier;
       }
    } else {
       float verticalFalloff = mix(1.0, 3.0, uSharpness);
       float sideGlow = smoothstep(0.5 / verticalFalloff, 0.0, distFromTop) * normElevation;

       if (normElevation < 0.02) sideGlow = 0.0;

       finalColor = mix(bodyColor, currentGlow, sideGlow * 1.5);

       float rimGlow = smoothstep(0.03, 0.0, distFromTop) * normElevation;
       finalColor += currentGlow * rimGlow;
    }

    finalColor += uRippleColor * vRippleAnim.x * 0.6;
    finalColor += vec3(1.0, 1.0, 1.0) * vRippleAnim.y * 1.2;

    // 远景雾加重、范围拉近：把残留在中远处的高亮碎点融进雾里（近景不受影响、零性能成本）。
    float aerialFog = smoothstep(26.0, 58.0, vDistance);
    vec3 atmosphericColor = mix(cBase1, cBase2, 0.4);
    finalColor = mix(finalColor, atmosphericColor, aerialFog * 0.7);

    float alphaFade = 1.0 - smoothstep(55.0, 78.0, vDistance);

    gl_FragColor = vec4(finalColor, alphaFade);
  }
`

export function AudioTopographyV2({ getFrequencies, playing }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const propsRef = useRef({ getFrequencies, playing })
  propsRef.current = { getFrequencies, playing }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false
    let raf = 0
    let cleanup: (() => void) | null = null

    import("three")
      .then((THREE) => {
        if (disposed || !canvasRef.current) return

        const count = GRID * GRID
        const freqBuf = new Uint8Array(BINS)

        const renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        })
        // 超采样：1x 屏也按 1.5 倍内部分辨率渲染，给远处小方块上的高对比亮点足够像素、
        // 抑制「撕裂」走样（MSAA 只管几何边缘、管不了着色器内部高亮）。桌面专属，可承受。
        renderer.setPixelRatio(Math.min(2, (window.devicePixelRatio || 1) * 1.5))
        renderer.toneMapping = THREE.NoToneMapping

        const scene = new THREE.Scene()
        // 近/远裁面收紧到地形真正所在的距离（原 0.1~400 比例过悬殊、深度精度被浪费）。
        // 注：实测「白块撕裂」并非 z-fighting（方块互不重叠）而是远处高亮小目标的走样，
        // 真正的解在超采样 + 压暗闪白；这里收紧仅作常规精度优化。相机最近 ~20 单位，2 不裁可见方块。
        const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 2, 220)

        // —— 涟漪 uniform：10 个槽，按拍触发 ——
        const ripples = Array.from({ length: 10 }, () => ({
          pos: new THREE.Vector2(),
          time: 0,
          strength: 0,
          isActive: 0,
          rippleType: 0,
        }))

        const uniforms = {
          uTime: { value: 0 },
          uSubBass: { value: 0 },
          uBass: { value: 0 },
          uLowMid: { value: 0 },
          uMid: { value: 0 },
          uHighMid: { value: 0 },
          uPresence: { value: 0 },
          uBrilliance: { value: 0 },
          uAir: { value: 0 },
          uWarmth: { value: 0 },
          uBrightness: { value: 0 },
          uSharpness: { value: 0 },
          uSmoothness: { value: 0 },
          uDensity: { value: 0 },
          uSpectralCentroid: { value: 0 },
          uEnergy: { value: 0 },
          uRipples: { value: ripples },
          uBaseColor1: { value: new THREE.Color(...THEME.baseColor1) },
          uBaseColor2: { value: new THREE.Color(...THEME.baseColor2) },
          uCoolCore: { value: new THREE.Color(...THEME.coolCore) },
          uCoolEdge: { value: new THREE.Color(...THEME.coolEdge) },
          uWarmCore: { value: new THREE.Color(...THEME.warmCore) },
          uWarmEdge: { value: new THREE.Color(...THEME.warmEdge) },
          uRippleColor: { value: new THREE.Color(...THEME.rippleColor) },
          uGlowIntensity: { value: THEME.glowIntensity },
        }

        const geo = new THREE.BoxGeometry(CUBE_W, 1, CUBE_W)
        const mat = new THREE.ShaderMaterial({
          uniforms,
          vertexShader: VERT,
          fragmentShader: FRAG,
          transparent: true,
        })
        const mesh = new THREE.InstancedMesh(geo, mat, count)
        mesh.frustumCulled = false // 实例铺满全场、自带包围球不可靠，关掉裁剪防误剔
        scene.add(mesh)

        // —— 实例铺成居中网格（底面在 y=0，着色器按 elevation 往上长）——
        const dummy = new THREE.Object3D()
        const half = (GRID - 1) / 2
        for (let i = 0; i < GRID; i++) {
          for (let j = 0; j < GRID; j++) {
            const k = i * GRID + j
            dummy.position.set((i - half) * SPACING, 0, (j - half) * SPACING)
            dummy.updateMatrix()
            mesh.setMatrixAt(k, dummy.matrix)
          }
        }
        mesh.instanceMatrix.needsUpdate = true

        const resize = () => {
          const w = Math.max(1, canvas.clientWidth)
          const h = Math.max(1, canvas.clientHeight)
          renderer.setSize(w, h, false)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
        }
        resize()
        window.addEventListener("resize", resize)

        // —— 频段提取（从 256 点 FFT 字节聚合）——
        const bandAvg = (a: number, b: number) => {
          let s = 0
          for (let i = a; i < b; i++) s += freqBuf[i]
          return s / ((b - a) * 255)
        }

        // 平滑后的频段/音色（EMA）
        const sm = {
          subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0,
          presence: 0, brilliance: 0, air: 0,
          warmth: 0, brightness: 0, sharpness: 0, smoothness: 0,
          density: 0, centroid: 0, energy: 0,
        }
        const ease = (cur: number, target: number) =>
          target > cur ? cur + (target - cur) * 0.5 : cur + (target - cur) * 0.12

        let beatBaseline = 0
        let lastRipple = -1
        let rippleIdx = 0
        let orbit = 0
        let tAcc = 0
        let lastT = performance.now()

        const loop = () => {
          const now = performance.now()
          const dt = Math.min(0.05, (now - lastT) / 1000)
          lastT = now
          tAcc += dt
          const p = propsRef.current
          const real = p.playing && p.getFrequencies(freqBuf)

          // 频段目标值
          let tSub = 0, tBass = 0, tLowMid = 0, tMid = 0, tHighMid = 0
          let tPres = 0, tBril = 0, tAir = 0
          let tWarm = 0, tBright = 0, tSharp = 0, tSmooth = 0, tDens = 0, tCent = 0, tEner = 0
          if (real) {
            tSub = bandAvg(0, 4)
            tBass = bandAvg(4, 12)
            tLowMid = bandAvg(12, 28)
            tMid = bandAvg(28, 60)
            tHighMid = bandAvg(60, 100)
            tPres = bandAvg(100, 150)
            tBril = bandAvg(150, 200)
            tAir = bandAvg(200, 256)
            tEner = bandAvg(0, 256)
            const low = tSub + tBass
            const high = tPres + tBril + tAir
            tWarm = low / (low + high + 0.001)
            tBright = high / (low + high + 0.001)
            let num = 0, den = 0
            for (let i = 0; i < BINS; i++) {
              num += i * freqBuf[i]
              den += freqBuf[i]
            }
            tCent = den > 0 ? num / den / BINS : 0
            tSharp = Math.min(1, tBright * 1.3)
            tSmooth = 1 - tSharp
            let cnt = 0
            for (let i = 0; i < BINS; i++) if (freqBuf[i] > 40) cnt++
            tDens = cnt / BINS
          }

          sm.subBass = ease(sm.subBass, tSub)
          sm.bass = ease(sm.bass, tBass)
          sm.lowMid = ease(sm.lowMid, tLowMid)
          sm.mid = ease(sm.mid, tMid)
          sm.highMid = ease(sm.highMid, tHighMid)
          sm.presence = ease(sm.presence, tPres)
          sm.brilliance = ease(sm.brilliance, tBril)
          sm.air = ease(sm.air, tAir)
          sm.warmth = ease(sm.warmth, tWarm)
          sm.brightness = ease(sm.brightness, tBright)
          sm.sharpness = ease(sm.sharpness, tSharp)
          sm.smoothness = ease(sm.smoothness, tSmooth)
          sm.density = ease(sm.density, tDens)
          sm.centroid = ease(sm.centroid, tCent)
          sm.energy = ease(sm.energy, tEner)

          uniforms.uTime.value = tAcc
          uniforms.uSubBass.value = sm.subBass
          uniforms.uBass.value = sm.bass
          uniforms.uLowMid.value = sm.lowMid
          uniforms.uMid.value = sm.mid
          uniforms.uHighMid.value = sm.highMid
          uniforms.uPresence.value = sm.presence
          uniforms.uBrilliance.value = sm.brilliance
          uniforms.uAir.value = sm.air
          uniforms.uWarmth.value = sm.warmth
          uniforms.uBrightness.value = sm.brightness
          uniforms.uSharpness.value = sm.sharpness
          uniforms.uSmoothness.value = sm.smoothness
          uniforms.uDensity.value = sm.density
          uniforms.uSpectralCentroid.value = sm.centroid
          uniforms.uEnergy.value = sm.energy

          // —— 按拍触发涟漪（低频骤升）——
          beatBaseline += (sm.bass - beatBaseline) * 0.04
          if (
            real &&
            sm.bass > 0.32 &&
            sm.bass > beatBaseline * 1.45 &&
            tAcc - lastRipple > 0.18
          ) {
            lastRipple = tAcc
            const field = GRID * SPACING * 0.55
            const r = ripples[rippleIdx % 10]
            r.pos.set((Math.random() - 0.5) * field, (Math.random() - 0.5) * field)
            r.time = tAcc
            r.strength = Math.min(1, sm.bass * 1.4)
            r.isActive = 1
            r.rippleType = sm.brilliance > 0.4 ? 1 : 0
            rippleIdx++
          }
          // 老涟漪到时关闭，避免 10 个槽长期占用
          for (let i = 0; i < 10; i++) {
            if (ripples[i].isActive > 0 && tAcc - ripples[i].time > 6) ripples[i].isActive = 0
          }

          // —— 相机绕中心缓慢自转 ——
          orbit += dt * ORBIT_SPEED
          camera.position.set(
            Math.sin(orbit) * ORBIT_RADIUS,
            ORBIT_HEIGHT,
            Math.cos(orbit) * ORBIT_RADIUS,
          )
          camera.lookAt(0, LOOK_Y, 0)

          renderer.render(scene, camera)
          raf = requestAnimationFrame(loop)
        }
        raf = requestAnimationFrame(loop)

        cleanup = () => {
          cancelAnimationFrame(raf)
          window.removeEventListener("resize", resize)
          geo.dispose()
          mat.dispose()
          mesh.dispose()
          renderer.dispose()
          renderer.forceContextLoss()
        }
      })
      .catch(() => {
        /* three 加载失败：静默回退（详情页仍有暗化背景），不影响播放 */
      })

    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      if (cleanup) cleanup()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  )
}
