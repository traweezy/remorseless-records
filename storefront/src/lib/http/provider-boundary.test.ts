import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createProviderSignal,
  fetchProviderRead,
  ProviderRequestError,
  providerProblem,
  runProviderReadOperation,
  type ProviderReadMetric,
  toProviderRequestError,
} from "@/lib/http/provider-boundary"

describe("provider boundary", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

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

  it("preserves a settled upstream failure when the caller aborts before handling", async () => {
    const caller = new AbortController()
    const failure = runProviderReadOperation(
      () => Promise.reject(new Error("private upstream detail")),
      {
        classifyRetry: () => ({ retry: false }),
        signal: caller.signal,
      }
    ).catch((error: unknown) => error)
    caller.abort()

    const result = await failure
    expect(result).toMatchObject({
      callerAborted: false,
      kind: "unavailable",
      name: "ProviderRequestError",
    })
    expect(JSON.stringify(result)).not.toContain("private upstream detail")
  })

  it("marks an in-flight caller abort without retaining provider details", async () => {
    const caller = new AbortController()
    const failure = runProviderReadOperation(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("private detail", "AbortError")),
            { once: true }
          )
        }),
      {
        classifyRetry: () => ({ retry: false }),
        signal: caller.signal,
      }
    ).catch((error: unknown) => error)
    caller.abort()

    const result = await failure
    expect(result).toMatchObject({
      callerAborted: true,
      kind: "timeout",
      name: "ProviderRequestError",
    })
    expect(JSON.stringify(result)).not.toContain("private detail")
  })

  it("keeps a provider deadline distinct from a later caller abort", async () => {
    const caller = new AbortController()
    const failure = runProviderReadOperation(
      () => new Promise<never>(() => undefined),
      {
        classifyRetry: () => ({ retry: false }),
        signal: caller.signal,
        timeoutMs: 20,
      }
    ).catch((error: unknown) => error)

    const result = await failure
    caller.abort()
    expect(result).toMatchObject({
      callerAborted: false,
      kind: "timeout",
      name: "ProviderRequestError",
    })
  })

  it("marks caller cancellation during retry backoff", async () => {
    const caller = new AbortController()
    const onRetry = vi.fn()
    const failure = runProviderReadOperation(
      () => Promise.reject(new TypeError("private transport detail")),
      {
        classifyRetry: () => ({ retry: true }),
        onRetry,
        signal: caller.signal,
      }
    ).catch((error: unknown) => error)
    await vi.waitFor(() => expect(onRetry).toHaveBeenCalledOnce())
    caller.abort()

    const result = await failure
    expect(result).toMatchObject({
      callerAborted: true,
      kind: "timeout",
      name: "ProviderRequestError",
    })
  })

  it("retries a transient safe read under one shared deadline", async () => {
    vi.useFakeTimers()
    const unavailable = new Response(null, {
      status: 503,
      headers: { "retry-after": "0" },
    })
    const success = new Response("{}", { status: 200 })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(success)

    const result = fetchProviderRead(
      "https://provider.test/content",
      {},
      { retryBaseDelayMs: 10 }
    )
    await vi.advanceTimersByTimeAsync(10)

    await expect(result).resolves.toBe(success)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(
      fetchSpy.mock.calls[1]?.[1]?.signal
    )
  })

  it("returns non-retryable responses and honors long Retry-After values", async () => {
    const notFound = new Response(null, { status: 404 })
    const unavailable = new Response(null, {
      status: 503,
      headers: { "retry-after": "120" },
    })
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(notFound)
      .mockResolvedValueOnce(unavailable)

    await expect(
      fetchProviderRead("https://provider.test/missing")
    ).resolves.toBe(notFound)
    await expect(
      fetchProviderRead("https://provider.test/unavailable")
    ).resolves.toBe(unavailable)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it("records a bounded outcome without allowing telemetry to fail the read", async () => {
    const success = new Response("{}", { status: 200 })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(success)
    const recordMetric = vi.fn((_metric: ProviderReadMetric): void => {
      throw new Error("telemetry unavailable")
    })

    await expect(
      fetchProviderRead("https://provider.test/content", {}, { recordMetric })
    ).resolves.toBe(success)
    expect(recordMetric).toHaveBeenCalledOnce()
    const recordedMetric = recordMetric.mock.calls[0]?.[0]
    expect(recordedMetric?.result).toBe("ok")
    expect(recordedMetric?.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("stops retry backoff when the caller cancels", async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 503 }))
    const failure = fetchProviderRead(
      "https://provider.test/content",
      { signal: caller.signal },
      { retryBaseDelayMs: 100 }
    ).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)

    caller.abort()

    await expect(failure).resolves.toMatchObject({
      kind: "timeout",
      name: "ProviderRequestError",
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("redacts repeated transport failures and rejects unsafe methods", async () => {
    vi.useFakeTimers()
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("provider.example/private-token"))
      .mockRejectedValueOnce(new Error("customer@example.test"))
    const failure = fetchProviderRead(
      "https://provider.test/content",
      {},
      { retryBaseDelayMs: 10 }
    ).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10)

    const result = await failure
    expect(result).toMatchObject({
      kind: "unavailable",
      message: "The upstream provider request failed",
      name: "ProviderRequestError",
    })
    expect(JSON.stringify(result)).not.toContain("private-token")
    expect(JSON.stringify(result)).not.toContain("customer")
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    await expect(
      fetchProviderRead("https://provider.test/write", { method: "POST" })
    ).rejects.toThrow("Provider retries require a safe read method")
    await expect(
      fetchProviderRead(
        new Request("https://provider.test/write", { method: "POST" })
      )
    ).rejects.toThrow("Provider retries require a safe read method")
  })
})
