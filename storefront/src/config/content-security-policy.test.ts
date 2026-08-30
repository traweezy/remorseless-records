import { describe, expect, it } from "vitest"

import {
  buildContentSecurityPolicy,
  createContentSecurityPolicyNonce,
  parseAllowedOrigin,
  resolveDynamicOrigins,
} from "@/config/content-security-policy"

describe("content security policy", () => {
  it("builds a production nonce policy without inline script execution", () => {
    const policy = buildContentSecurityPolicy({
      environment: {
        NEXT_PUBLIC_MEDUSA_URL: "http://insecure.example.com/store/products",
        MEDUSA_BACKEND_URL: "https://backend.example.com/store/products",
        NEXT_PUBLIC_MEDIA_URL: "https://media.example.com/bucket/",
      },
      isDevelopment: false,
      isSecureRequest: true,
      nonce: "0123456789abcdef0123456789abcdef",
    })
    const scriptDirective = policy
      .split("; ")
      .find((directive) => directive.startsWith("script-src "))

    expect(scriptDirective).toContain("'self'")
    expect(scriptDirective).toContain(
      "'nonce-0123456789abcdef0123456789abcdef'"
    )
    expect(scriptDirective).toContain("'strict-dynamic'")
    expect(scriptDirective).toContain("https://js.stripe.com")
    expect(scriptDirective).not.toContain("'unsafe-inline'")
    expect(scriptDirective).not.toContain("'unsafe-eval'")
    expect(policy).toContain("script-src-attr 'none'")
    expect(policy).toContain("base-uri 'none'")
    expect(policy).toContain("https://backend.example.com")
    expect(policy).toContain("https://media.example.com")
    expect(policy).not.toContain("http://insecure.example.com")
    expect(policy).toContain("upgrade-insecure-requests")
    expect(policy).not.toContain("images.unsplash.com")
    expect(policy).not.toContain("medusa-server-testing.s3.amazonaws.com")
  })

  it("allows only the development evaluator without allowing inline scripts", () => {
    const policy = buildContentSecurityPolicy({
      environment: {
        NEXT_PUBLIC_MEDUSA_URL: "http://localhost:9000/store/products",
      },
      isDevelopment: true,
      isSecureRequest: false,
      nonce: "0123456789abcdef0123456789abcdef",
    })
    const scriptDirective = policy
      .split("; ")
      .find((directive) => directive.startsWith("script-src "))

    expect(scriptDirective).not.toContain("'unsafe-inline'")
    expect(scriptDirective).toContain("'unsafe-eval'")
    expect(policy).toContain("http://localhost:9000")
    expect(policy).not.toContain("upgrade-insecure-requests")
  })

  it("rejects credential-bearing and non-HTTP origins", () => {
    expect(parseAllowedOrigin("https://user:password@example.com")).toBeNull()
    expect(parseAllowedOrigin("javascript:alert(1)")).toBeNull()
  })

  it("generates unique nonces and rejects header injection", () => {
    const firstNonce = createContentSecurityPolicyNonce()
    const secondNonce = createContentSecurityPolicyNonce()

    expect(firstNonce).toMatch(/^[a-f\d]{32}$/)
    expect(secondNonce).toMatch(/^[a-f\d]{32}$/)
    expect(secondNonce).not.toBe(firstNonce)
    expect(() =>
      buildContentSecurityPolicy({
        isDevelopment: false,
        isSecureRequest: true,
        nonce: "invalid; script-src *",
      })
    ).toThrow("Content Security Policy nonce is invalid")
  })

  it("keeps production HTTP assets on HTTP for local validation", () => {
    const policy = buildContentSecurityPolicy({
      isDevelopment: false,
      isSecureRequest: false,
      nonce: "0123456789abcdef0123456789abcdef",
    })

    expect(policy).not.toContain("upgrade-insecure-requests")
    expect(policy).not.toContain("block-all-mixed-content")
  })

  it("normalizes and deduplicates configured HTTP origins", () => {
    expect(
      resolveDynamicOrigins({
        MEDUSA_BACKEND_URL: "https://api.example.com/path",
        NEXT_PUBLIC_MEDUSA_BACKEND_URL: "https://api.example.com/other",
        NEXT_PUBLIC_MEDIA_URL: "media.example.com/files",
      })
    ).toEqual(["https://api.example.com", "https://media.example.com"])
  })
})
