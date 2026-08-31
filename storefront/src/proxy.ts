import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import {
  buildContentSecurityPolicy,
  buildTrustedTypesReportingEndpoints,
  buildTrustedTypesReportOnlyPolicy,
  createContentSecurityPolicyNonce,
} from "@/config/content-security-policy"
import {
  applyCorrelationToRequestHeaders,
  applyCorrelationToResponse,
  createRequestCorrelation,
} from "@/lib/http/correlation"
import {
  getActiveTraceContext,
  registerRequestCompletion,
} from "@/lib/observability/request-completion"

export const proxy = (request: NextRequest): NextResponse => {
  const correlation = createRequestCorrelation(
    request.headers,
    getActiveTraceContext()
  )
  registerRequestCompletion(correlation)
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
    isSecureRequest: request.nextUrl.protocol === "https:",
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
  response.headers.set(
    "Content-Security-Policy-Report-Only",
    buildTrustedTypesReportOnlyPolicy()
  )
  response.headers.set(
    "Reporting-Endpoints",
    buildTrustedTypesReportingEndpoints()
  )
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
