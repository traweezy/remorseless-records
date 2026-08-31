import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import { proxy } from "@/proxy"

describe("Storefront security proxy", () => {
  it("forwards a fresh nonce and matching strict CSP", () => {
    const response = proxy(new NextRequest("https://storefront.example.com/"))
    const policy = response.headers.get("Content-Security-Policy")
    const nonce = response.headers.get("x-middleware-request-x-nonce")
    const forwardedPolicy = response.headers.get(
      "x-middleware-request-content-security-policy"
    )
    const reportOnlyPolicy = response.headers.get(
      "Content-Security-Policy-Report-Only"
    )
    const scriptDirective = policy
      ?.split("; ")
      .find((directive) => directive.startsWith("script-src "))

    expect(nonce).toMatch(/^[a-f\d]{32}$/)
    expect(forwardedPolicy).toBe(policy)
    expect(scriptDirective).toContain(`'nonce-${nonce}'`)
    expect(scriptDirective).toContain("'strict-dynamic'")
    expect(scriptDirective).not.toContain("'unsafe-inline'")
    expect(policy).toContain("upgrade-insecure-requests")
    expect(reportOnlyPolicy).toBe(
      "trusted-types nextjs nextjs#bundler remorseless-stripe-js; require-trusted-types-for 'script'; report-uri /api/security/trusted-types-report; report-to trusted-types"
    )
    expect(response.headers.get("Reporting-Endpoints")).toBe(
      'trusted-types="/api/security/trusted-types-report"'
    )
  })

  it("does not upgrade local HTTP subresources to HTTPS", () => {
    const response = proxy(new NextRequest("http://127.0.0.1:3000/"))

    expect(response.headers.get("Content-Security-Policy")).not.toContain(
      "upgrade-insecure-requests"
    )
  })

  it("does not reuse nonces across document requests", () => {
    const first = proxy(
      new NextRequest("https://storefront.example.com/catalog")
    )
    const second = proxy(
      new NextRequest("https://storefront.example.com/catalog")
    )

    expect(first.headers.get("x-middleware-request-x-nonce")).not.toBe(
      second.headers.get("x-middleware-request-x-nonce")
    )
  })

  it("correlates API requests without attaching document CSP", () => {
    const traceId = "0123456789abcdef0123456789abcdef"
    const response = proxy(
      new NextRequest("https://storefront.example.com/api/cart", {
        headers: {
          traceparent: `00-${traceId}-0123456789abcdef-01`,
          "x-request-id": "request_01",
        },
      })
    )

    expect(response.headers.get("X-Request-Id")).toBe("request_01")
    expect(response.headers.get("traceparent")).toMatch(
      new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`)
    )
    expect(response.headers.get("x-middleware-request-x-request-id")).toBe(
      "request_01"
    )
    expect(response.headers.get("Content-Security-Policy")).toBeNull()
    expect(
      response.headers.get("Content-Security-Policy-Report-Only")
    ).toBeNull()
  })
})
