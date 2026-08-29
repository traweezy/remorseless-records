import { describe, expect, it } from "vitest"

import {
  createProviderSignal,
  ProviderRequestError,
  providerProblem,
  toProviderRequestError,
} from "@/lib/http/provider-boundary"

describe("provider boundary", () => {
  it("creates a deadline and preserves caller cancellation", () => {
    const caller = new AbortController()
    const combined = createProviderSignal(caller.signal, 1_000)

    expect(combined).toBeInstanceOf(AbortSignal)
    expect(combined.aborted).toBe(false)

    caller.abort()
    expect(combined.aborted).toBe(true)
  })

  it("rejects invalid deadlines", () => {
    expect(() => createProviderSignal(undefined, 0)).toThrow(RangeError)
    expect(() => createProviderSignal(undefined, 1.5)).toThrow(RangeError)
  })

  it("maps only typed provider failures to safe gateway problems", () => {
    expect(
      providerProblem(new ProviderRequestError("timeout"), "catalog")
    ).toEqual({
      code: "catalog_timeout",
      detail: "The upstream service did not respond in time.",
      status: 504,
    })
    expect(
      providerProblem(new ProviderRequestError("unavailable"), "catalog")
    ).toEqual({
      code: "catalog_unavailable",
      detail: "The upstream service is temporarily unavailable.",
      status: 502,
    })
    expect(providerProblem(new Error("internal"), "catalog")).toBeNull()
  })

  it("redacts provider details while retaining timeout semantics", () => {
    const timeout = toProviderRequestError(
      new DOMException("https://secret.example/token", "TimeoutError")
    )
    const unavailable = toProviderRequestError(
      new Error("provider body contained customer@example.test")
    )

    expect(timeout.kind).toBe("timeout")
    expect(unavailable.kind).toBe("unavailable")
    expect(JSON.stringify([timeout, unavailable])).not.toContain("secret")
    expect(JSON.stringify([timeout, unavailable])).not.toContain("customer")
    expect(toProviderRequestError(timeout)).toBe(timeout)
  })
})
