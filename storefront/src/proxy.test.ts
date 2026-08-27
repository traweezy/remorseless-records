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
    const scriptDirective = policy
      ?.split("; ")
      .find((directive) => directive.startsWith("script-src "))

    expect(nonce).toMatch(/^[a-f\d]{32}$/)
    expect(forwardedPolicy).toBe(policy)
    expect(scriptDirective).toContain(`'nonce-${nonce}'`)
    expect(scriptDirective).toContain("'strict-dynamic'")
    expect(scriptDirective).not.toContain("'unsafe-inline'")
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
})
