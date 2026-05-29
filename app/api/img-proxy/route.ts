import { NextRequest, NextResponse } from "next/server"

// Skipped at static-export time; only used by the music page in normal runs.
export const dynamic = "force-dynamic"

// Allow-list of remote hosts. Lets the cover-color extractor on /music load
// NetEase album covers as same-origin (so client-side canvas getImageData
// works), while preventing the proxy from being abused as an open relay.
const ALLOWED_HOSTS = /(^|\.)music\.126\.net$/

/**
 * Same-origin image proxy. Streams the remote bytes through with the original
 * content-type, plus a long cache header so subsequent extractions are free.
 *
 * Usage: /api/img-proxy?url=https%3A%2F%2Fp3.music.126.net%2F...
 */
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url")
  if (!target) {
    return new NextResponse("missing url", { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return new NextResponse("invalid url", { status: 400 })
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.test(parsed.hostname)) {
    return new NextResponse("host not allowed", { status: 403 })
  }

  let upstream: Response
  try {
    upstream = await fetch(parsed.toString(), {
      // Edge/cache-friendly; covers are immutable so a day is fine.
      next: { revalidate: 86400 },
    })
  } catch {
    return new NextResponse("upstream fetch failed", { status: 502 })
  }
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("upstream error", { status: 502 })
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") || "image/jpeg",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  })
}
