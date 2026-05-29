"use client"

/**
 * Film grain layer. A tiled SVG fractal-noise pattern over the whole viewport
 * with subtle translation animation, giving the static cover backdrop a
 * shimmering "filmed" quality. CSS-only, ~0 runtime cost.
 *
 * Implementation notes:
 *  - The SVG is an inline data URI so we don't ship an extra asset.
 *  - `mix-blend-mode: overlay` lets the noise add light to bright areas and
 *    darken shadows, instead of flatly tinting everything grey.
 *  - The keyframe steps to discrete positions (not a smooth tween) so each
 *    "frame" of the noise pattern looks like a different sample — exactly
 *    how real film grain looks.
 *  - Container is sized -50% on each side so the translated noise tile never
 *    leaves a visible seam at viewport edges.
 */
export function Grain() {
  return (
    <div
      className="pointer-events-none absolute z-[2]"
      aria-hidden
      style={{
        inset: "-25%",
        backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(
          `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'>
            <filter id='n'>
              <feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>
              <feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/>
            </filter>
            <rect width='100%' height='100%' filter='url(#n)'/>
          </svg>`,
        )}")`,
        backgroundRepeat: "repeat",
        opacity: 0.12,
        mixBlendMode: "overlay",
        animation: "grainShimmer 0.9s steps(10) infinite",
      }}
    >
      <style jsx>{`
        @keyframes grainShimmer {
          0%   { transform: translate(0, 0); }
          10%  { transform: translate(-5%, -10%); }
          20%  { transform: translate(-15%, 5%); }
          30%  { transform: translate(7%, -25%); }
          40%  { transform: translate(-5%, 25%); }
          50%  { transform: translate(-15%, 10%); }
          60%  { transform: translate(15%, 0%); }
          70%  { transform: translate(0%, 15%); }
          80%  { transform: translate(3%, 35%); }
          90%  { transform: translate(-10%, 10%); }
          100% { transform: translate(0, 0); }
        }
      `}</style>
    </div>
  )
}
