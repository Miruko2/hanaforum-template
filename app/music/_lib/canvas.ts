import type { Track } from "../_data/tracks"

export type PackedCard = {
  track: Track
  col: number          // leftmost column index (0..cols-1)
  span: 1 | 2          // how many columns this card spans
  worldX: number       // top-left in tile coords
  worldY: number
  width: number
  height: number
}

export type PackResult = {
  cards: PackedCard[]
  cols: number
  unitWidth: number
  gap: number
  tileW: number        // total horizontal repeat period
  tileH: number        // total vertical repeat period (= max of column heights)
}

/**
 * Shortest-column packer with horizontal spanning support.
 *
 * For each track we choose a slot:
 *   - span=1: pick the single column with the lowest height
 *   - span=2: pick the adjacent pair (c, c+1) whose max(heights) is lowest
 *
 * After packing, the wrap period for the whole tile is the max column height,
 * so every column wraps at the same Y — no per-column desync, no jagged seam.
 */
export function packTracks(
  tracks: Track[],
  cols: number,
  unitWidth: number,
  gap: number,
): PackResult {
  const colHeights = new Array(cols).fill(0)
  const cards: PackedCard[] = []

  for (const track of tracks) {
    const span = track.span
    if (span === 1) {
      // Find shortest column
      let bestCol = 0
      let bestH = colHeights[0]
      for (let c = 1; c < cols; c++) {
        if (colHeights[c] < bestH) {
          bestH = colHeights[c]
          bestCol = c
        }
      }
      const w = unitWidth - gap
      const h = Math.round(w * track.ratio)
      cards.push({
        track,
        col: bestCol,
        span: 1,
        worldX: bestCol * unitWidth,
        worldY: bestH,
        width: w,
        height: h,
      })
      colHeights[bestCol] = bestH + h + gap
    } else {
      // Find adjacent pair with lowest max height
      let bestStart = 0
      let bestMax = Math.max(colHeights[0], colHeights[1])
      for (let c = 1; c < cols - 1; c++) {
        const m = Math.max(colHeights[c], colHeights[c + 1])
        if (m < bestMax) {
          bestMax = m
          bestStart = c
        }
      }
      const w = unitWidth * 2 - gap
      const h = Math.round(w * track.ratio)
      cards.push({
        track,
        col: bestStart,
        span: 2,
        worldX: bestStart * unitWidth,
        worldY: bestMax,
        width: w,
        height: h,
      })
      const newH = bestMax + h + gap
      colHeights[bestStart] = newH
      colHeights[bestStart + 1] = newH
    }
  }

  const tileH = Math.max(...colHeights)
  const tileW = cols * unitWidth

  return { cards, cols, unitWidth, gap, tileW, tileH }
}

export type Instance = {
  key: string
  card: PackedCard
  // World position of the card's top-left, in panned (= world) coordinates.
  worldX: number
  worldY: number
}

/**
 * Return all card instances (base × tile copies) that intersect the viewport.
 * Tile wraps as a unit in both axes since columns all share tileH after
 * packing — no per-column wrap, no visible seam.
 *
 * margin: extra pixels around viewport to keep predrawn so wrap-in is
 * never visible during a drag.
 */
export function computeInstances(
  pack: PackResult,
  panX: number,
  panY: number,
  viewW: number,
  viewH: number,
  margin = 280,
): Instance[] {
  const { cards, tileW, tileH } = pack
  const out: Instance[] = []

  for (const card of cards) {
    const baseScreenX = card.worldX + panX
    const kxMin = Math.floor((-baseScreenX - card.width - margin) / tileW)
    const kxMax = Math.floor((viewW - baseScreenX + margin) / tileW)

    const baseScreenY = card.worldY + panY
    const kyMin = Math.floor((-baseScreenY - card.height - margin) / tileH)
    const kyMax = Math.floor((viewH - baseScreenY + margin) / tileH)

    for (let kx = kxMin; kx <= kxMax; kx++) {
      for (let ky = kyMin; ky <= kyMax; ky++) {
        out.push({
          key: `${card.track.id}_${kx}_${ky}`,
          card,
          worldX: card.worldX + kx * tileW,
          worldY: card.worldY + ky * tileH,
        })
      }
    }
  }

  return out
}

export type FisheyeTransform = {
  scale: number
  z: number
  rotX: number      // degrees
  rotY: number      // degrees
  blur: number
  opacity: number
}

/**
 * Spherical-surface fisheye. Each card sits on an imaginary sphere whose
 * pole is the focal point: as you move radially away from the focal point,
 * the card tilts (rotates) to face it and recedes into Z.
 *
 *   d   = distance from card center to focal point
 *   k   = exp(-d / radius)           // 1 at pole, ~0 at horizon
 *   rotY = -(dx / radius) * 30°      // right of focus tilts to face left
 *   rotX =  (dy / radius) * 30°      // below focus tilts to face up
 *   z    = -400 + k * 550            // edges deep behind, focus pops forward
 *   scale = 0.4 + k * 0.85           // 0.4 .. 1.25
 *   blur  = (1 - k) * 5              // 0 .. 5px
 *   opacity = 0.3 + k * 0.7          // 0.3 .. 1.0
 *
 * Rotations are clamped so cards never flip past 90° even at large
 * pan offsets.
 */
const MAX_TILT_DEG = 32
const TILT_GAIN = 1.6 // scales the linear tilt input before clamp

export function fisheye(
  cardCx: number,
  cardCy: number,
  focusX: number,
  focusY: number,
  radius: number,
): FisheyeTransform {
  const dx = cardCx - focusX
  const dy = cardCy - focusY
  const d = Math.hypot(dx, dy)
  // Gaussian falloff (power-2) instead of pure exponential (power-1).
  // The square inside flattens the curve near the focal point, expanding the
  // "near-clear" central zone. Edge value at d=radius is unchanged (1/e),
  // so far-away cards keep their existing look. Bump the power to 3 for an
  // even wider plateau, or drop to 1 for the old pointy peak.
  const k = Math.exp(-Math.pow(d / radius, 2))

  // Opacity gets its own much wider radius so the central "bright" zone
  // spans most of the viewport. Other properties (scale, z, blur, tilt)
  // keep the tighter radius for the crisp fisheye depth effect.
  const kOpacity = Math.exp(-Math.pow(d / (radius * 2.5), 2))

  const rawY = -(dx / radius) * TILT_GAIN * (180 / Math.PI) * 0.35
  const rawX = (dy / radius) * TILT_GAIN * (180 / Math.PI) * 0.35
  const rotY = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, rawY))
  const rotX = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, rawX))

  return {
    // Scale capped at 1.0 so center cards stay at "natural size" and don't
    // collide with neighbors. Enlargement comes from hover only.
    scale: 0.5 + k * 0.5,
    // Z capped at 0 — periphery still recedes, but focal cards don't pop out.
    z: -300 + k * 300,
    rotX,
    rotY,
    blur: (1 - k) * 3.5,
    opacity: 0.4 + kOpacity * 0.6,
  }
}
