import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import {
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce,
} from "@/config/content-security-policy"
import {
  applyCorrelationToRequestHeaders,
  applyCorrelationToResponse,
  createRequestCorrelation,
} from "@/lib/http/correlation"

export const proxy = (request: NextRequest): NextResponse => {
  const correlation = createRequestCorrelation(request.headers)
  const requestHeaders = new Headers(request.headers)
  applyCorrelationToRequestHeaders(requestHeaders, correlation)

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return applyCorrelationToResponse(
      NextResponse.next({ request: { headers: requestHeaders } }),
      correlation
    )
  }

  const nonce = createContentSecurityPolicyNonce()
  const contentSecurityPolicy = buildContentSecurityPolicy({
    isDevelopment: process.env.NODE_ENV === "development",
    nonce,
  })
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy)
  requestHeaders.set("x-nonce", nonce)

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
  response.headers.set("Content-Security-Policy", contentSecurityPolicy)
  return applyCorrelationToResponse(response, correlation)
}

export const config = {
  matcher: [
    "/api/:path*",
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|apple-touch-icon.png|opengraph-image.jpg|twitter-image.jpg|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
}
