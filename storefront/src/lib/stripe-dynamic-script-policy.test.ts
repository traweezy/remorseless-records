import { afterEach, describe, expect, it, vi } from "vitest"
import {
  installStripeDynamicScriptPolicy,
  requireStripeDynamicScriptURL,
} from "./stripe-dynamic-script-policy"

const convert = (url: string) =>
  requireStripeDynamicScriptURL(
    url,
    "TrustedScriptURL",
    "HTMLScriptElement src"
  )

afterEach(() => vi.unstubAllGlobals())

describe("Stripe's dynamic script boundary", () => {
  it.each([
    "https://js.stripe.com/v3/stripe-next-abc123.js",
    "https://b.js.stripe.com/dahlia/elements-123.js",
  ])("accepts a canonical Stripe script: %s", (url) => {
    expect(convert(url)).toBe(url)
  })

  it.each([
    "https://js.stripe.com.attacker.test/chunk.js",
    "https://js.stripe.com@attacker.test/chunk.js",
    "https://attacker.test/js.stripe.com/chunk.js",
    "https://user@js.stripe.com/chunk.js",
    "http://js.stripe.com/chunk.js",
    "//js.stripe.com/chunk.js",
    "https://js.stripe.com:443/chunk.js",
    "https://js.stripe.com:444/chunk.js",
    "https://a.b.js.stripe.com/chunk.js",
    "https://api.stripe.com/chunk.js",
    "https://js.stripe.com/chunk.js?callback=attack",
    "https://js.stripe.com/chunk.js#attack",
    "https://js.stripe.com/../chunk.js",
    "https://js.stripe.com/./chunk.js",
    "https://js.stripe.com/%2e/chunk.js",
    " https://js.stripe.com/chunk.js",
    "https://js.stripe.com/chunk.js\n",
    "https://js.stripe.com/\\attacker.test/chunk.js",
    "https://js.stripe.com/frame.html",
    "javascript:alert(1)",
    "data:text/javascript,alert(1)",
    "blob:https://js.stripe.com/chunk.js",
    "/local.js",
    `https://js.stripe.com/${"x".repeat(2048)}.js`,
  ])("rejects an unrelated or ambiguous URL: %s", (url) => {
    expect(() => convert(url)).toThrow(
      "Stripe dynamic script URL is not trusted"
    )
  })

  it.each([
    ["TrustedHTML", "Element innerHTML"],
    ["TrustedScript", "HTMLScriptElement text"],
    ["TrustedScriptURL", "Worker constructor"],
    ["TrustedScriptURL", "HTMLObjectElement data"],
    ["TrustedScriptURL", ""],
  ])("rejects a different type or sink: %s / %s", (type, sink) => {
    expect(() =>
      requireStripeDynamicScriptURL(
        "https://js.stripe.com/chunk.js",
        type,
        sink
      )
    ).toThrow("Stripe dynamic script URL is not trusted")
  })

  it("installs once without adding HTML or executable text conversion", () => {
    const createPolicy = vi.fn()
    vi.stubGlobal("trustedTypes", { createPolicy, defaultPolicy: null })
    installStripeDynamicScriptPolicy()
    installStripeDynamicScriptPolicy()
    expect(createPolicy).toHaveBeenCalledExactlyOnceWith("default", {
      createScriptURL: requireStripeDynamicScriptURL,
    })
  })

  it("does not silently reuse another default policy", () => {
    const createPolicy = vi.fn()
    vi.stubGlobal("trustedTypes", { createPolicy, defaultPolicy: {} })
    expect(installStripeDynamicScriptPolicy).toThrow("unexpected default")
    expect(createPolicy).not.toHaveBeenCalled()
  })

  it("does not suppress CSP rejection or cache a failed registration", () => {
    const createPolicy = vi.fn().mockImplementationOnce(() => {
      throw new TypeError("blocked by CSP")
    })
    vi.stubGlobal("trustedTypes", { createPolicy })
    expect(installStripeDynamicScriptPolicy).toThrow("blocked by CSP")
    installStripeDynamicScriptPolicy()
    expect(createPolicy).toHaveBeenCalledTimes(2)
  })

  it.each([null, {}, { createPolicy: true }])(
    "rejects an invalid factory",
    (factory) => {
      vi.stubGlobal("trustedTypes", factory)
      expect(installStripeDynamicScriptPolicy).toThrow("factory is unavailable")
    }
  )

  it("supports browsers without Trusted Types and server rendering", () => {
    vi.stubGlobal("trustedTypes", undefined)
    expect(installStripeDynamicScriptPolicy).not.toThrow()
    vi.stubGlobal("window", undefined)
    expect(installStripeDynamicScriptPolicy).not.toThrow()
  })
})
