import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createJsonLdScript,
  JSON_LD_TRUSTED_TYPES_POLICY,
  MAX_JSON_LD_BYTES,
  requireCanonicalJsonLd,
  serializeJsonLd,
} from "@/lib/seo/json-ld"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("JSON-only Trusted Types boundary", () => {
  it.each([
    ["executable source", "globalThis.injected=true"],
    ["trailing code", "{};globalThis.injected=true"],
    ["HTML", "<script>globalThis.injected=true</script>"],
    ["primitive", "true"],
    ["null", "null"],
    ["string", '"plain text"'],
    ["mixed array", '[{"name":"ok"},1]'],
    ["whitespace", '{ "name": "ok" }'],
    ["duplicate keys", '{"name":"first","name":"second"}'],
    ["raw delimiters", '{"name":"<script>&"}'],
    ["noncanonical escape", '{"name":"\\u0041"}'],
    ["numeric overflow", '{"number":1e400}'],
    [
      "oversized data",
      serializeJsonLd({ name: "x".repeat(MAX_JSON_LD_BYTES) }),
    ],
  ])("rejects %s before creating a policy or DOM node", (_name, candidate) => {
    const createPolicy = vi.fn()
    vi.stubGlobal("trustedTypes", { createPolicy, isScript: vi.fn() })
    const createElement = vi.spyOn(document, "createElement")
    expect(() => createJsonLdScript(document, candidate)).toThrow(
      "JSON-LD must be canonical serialized object data."
    )
    expect(createPolicy).not.toHaveBeenCalled()
    expect(createElement).not.toHaveBeenCalled()
  })

  it("bounds UTF-8 bytes and accepts the exact byte limit", () => {
    const overhead = serializeJsonLd({ name: "" }).length
    const exact = serializeJsonLd({
      name: "x".repeat(MAX_JSON_LD_BYTES - overhead),
    })
    expect(requireCanonicalJsonLd(exact)).toBe(exact)
    const multibyte = serializeJsonLd({
      name: "é".repeat(MAX_JSON_LD_BYTES / 2),
    })
    expect(multibyte.length).toBeLessThan(MAX_JSON_LD_BYTES)
    expect(() => requireCanonicalJsonLd(multibyte)).toThrow(TypeError)
  })

  it("passes only canonical data through one locally owned createScript policy", () => {
    const branded = new WeakSet<object>()
    const createPolicy = vi.fn(
      (_name: string, rules: { createScript: (value: string) => string }) => ({
        createScript: (candidate: string) => {
          const value = rules.createScript(candidate)
          const trusted = { toString: () => value }
          branded.add(trusted)
          return trusted
        },
      })
    )
    vi.stubGlobal("trustedTypes", {
      createPolicy,
      isScript: (value: object) => branded.has(value),
    })
    const hostile = {
      name: "</script><script>globalThis.injected=true</script>",
      description: "<img src=x onerror=alert(1)> & \u2028\u2029",
      nested: { constructor: "data", toJSON: "data", value: null },
    }
    for (const data of [hostile, [hostile]]) {
      const script = createJsonLdScript(document, serializeJsonLd(data))
      expect(script.type).toBe("application/ld+json")
      expect(script.getAttributeNames()).toEqual(["type"])
      expect(script.children).toHaveLength(0)
      expect(script.isConnected).toBe(false)
      expect(JSON.parse(script.text)).toEqual(data)
    }
    expect(createPolicy).toHaveBeenCalledTimes(1)
    const call = createPolicy.mock.calls[0]
    expect(call?.[0]).toBe(JSON_LD_TRUSTED_TYPES_POLICY)
    expect(Object.keys(call?.[1] ?? {})).toEqual(["createScript"])
    expect(() => call?.[1].createScript("globalThis.injected=true")).toThrow(
      TypeError
    )
  })

  it("uses native data text only when Trusted Types is absent", () => {
    vi.stubGlobal("trustedTypes", undefined)
    const script = createJsonLdScript(document, '{"name":"Native data"}')
    expect(script.text).toBe('{"name":"Native data"}')
    expect(script.type).toBe("application/ld+json")
  })

  it.each([null, {}, { createPolicy: vi.fn() }])(
    "fails closed for an incomplete factory: %s",
    (factory) => {
      vi.stubGlobal("trustedTypes", factory)
      expect(() => createJsonLdScript(document, "{}")).toThrow(
        "JSON-LD Trusted Types factory is unavailable."
      )
    }
  )

  it("propagates denied/duplicate policy creation without reusing a foreign policy", () => {
    const denied = new TypeError("Policy creation denied")
    const getPolicy = vi.fn()
    vi.stubGlobal("trustedTypes", {
      createPolicy: () => {
        throw denied
      },
      isScript: vi.fn(),
      getPolicy,
    })
    expect(() => createJsonLdScript(document, "{}")).toThrow(denied)
    expect(getPolicy).not.toHaveBeenCalled()
  })

  it.each([null, {}, { createScript: "invalid" }])(
    "fails closed when creation returns an invalid policy: %s",
    (policy) => {
      vi.stubGlobal("trustedTypes", {
        createPolicy: () => policy,
        isScript: vi.fn(),
      })
      expect(() => createJsonLdScript(document, "{}")).toThrow(
        "JSON-LD Trusted Types policy is unavailable."
      )
    }
  )

  it("rejects a policy that returns an untrusted value", () => {
    vi.stubGlobal("trustedTypes", {
      createPolicy: () => ({ createScript: (value: string) => value }),
      isScript: () => false,
    })
    expect(() => createJsonLdScript(document, "{}")).toThrow(
      "JSON-LD Trusted Types policy returned invalid data."
    )
  })

  it("fails closed if the native text setter rejects assignment", () => {
    vi.stubGlobal("trustedTypes", undefined)
    vi.spyOn(Reflect, "set").mockReturnValue(false)
    expect(() => createJsonLdScript(document, "{}")).toThrow(
      "JSON-LD text assignment failed."
    )
  })
})
