import { faker } from "@faker-js/faker"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const createRequest = (
  url: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
  }
): Request =>
  new Request(url, {
    method: init?.method ?? "POST",
    ...(init?.headers ? { headers: init.headers } : {}),
    ...(typeof init?.body === "string" ? { body: init.body } : {}),
  })

describe("route guards", () => {
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
  const originalBaseUrl = process.env.NEXT_PUBLIC_BASE_URL

  beforeEach(() => {
    faker.seed(7301)
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-02-08T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl
    process.env.NEXT_PUBLIC_BASE_URL = originalBaseUrl
  })

  it("allows trusted origin and referer from request hosts", async () => {
    const { enforceTrustedOrigin } = await import("@/lib/security/route-guards")
    const trustedHost = faker.internet.domainName().toLowerCase()
    const request = createRequest(`https://${trustedHost}/api/cart`, {
      headers: {
        origin: `https://${trustedHost}`,
        referer: `https://${trustedHost}/catalog`,
        "x-forwarded-host": trustedHost,
      },
    })

    expect(enforceTrustedOrigin(request)).toBeNull()
  })

  it("blocks untrusted origin", async () => {
    const { enforceTrustedOrigin } = await import("@/lib/security/route-guards")
    const trustedHost = faker.internet.domainName().toLowerCase()
    const badHost = faker.internet.domainName().toLowerCase()
    const request = createRequest(`https://${trustedHost}/api/cart`, {
      headers: {
        origin: `https://${badHost}`,
        "x-forwarded-host": trustedHost,
      },
    })

    const response = enforceTrustedOrigin(request)

    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({
      code: "invalid_origin",
      detail: "Request origin is not allowed.",
      status: 403,
      type: "https://remorselessrecords.com/problems/invalid_origin",
    })
    expect(response?.headers.get("content-type")).toContain(
      "application/problem+json"
    )
    expect(response?.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
    expect(response?.headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/
    )
  })

  it("blocks invalid referer values", async () => {
    const { enforceTrustedOrigin } = await import("@/lib/security/route-guards")
    const trustedHost = faker.internet.domainName().toLowerCase()
    const request = createRequest(`https://${trustedHost}/api/cart`, {
      headers: {
        origin: `https://${trustedHost}`,
        referer: "not-a-valid-url",
        "x-forwarded-host": trustedHost,
      },
    })

    const response = enforceTrustedOrigin(request)

    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({
      code: "invalid_referer",
      detail: "Request referer is not allowed.",
      status: 403,
    })
  })

  it("uses configured site url as a trusted host", async () => {
    const { enforceTrustedOrigin } = await import("@/lib/security/route-guards")
    const trustedHost = faker.internet.domainName().toLowerCase()
    process.env.NEXT_PUBLIC_SITE_URL = `https://${trustedHost}`
    process.env.NEXT_PUBLIC_BASE_URL = `https://${faker.internet.domainName().toLowerCase()}`

    const request = createRequest(
      `https://${faker.internet.domainName().toLowerCase()}/api/contact`,
      {
        headers: {
          origin: `https://${trustedHost}`,
        },
      }
    )

    expect(enforceTrustedOrigin(request)).toBeNull()
  })

  it("does not trust a client-supplied forwarded host", async () => {
    const { enforceTrustedOrigin } = await import("@/lib/security/route-guards")
    const trustedHost = faker.internet.domainName().toLowerCase()
    const attackerHost = faker.internet.domainName().toLowerCase()
    const request = createRequest(`https://${trustedHost}/api/cart`, {
      headers: {
        origin: `https://${attackerHost}`,
        "x-forwarded-host": attackerHost,
      },
    })

    expect(enforceTrustedOrigin(request)?.status).toBe(403)
  })

  it("blocks mutations when both origin and referer are missing", async () => {
    const { enforceTrustedOrigin } = await import("@/lib/security/route-guards")
    const host = faker.internet.domainName().toLowerCase()
    const request = createRequest(`https://${host}/api/contact`, {
      headers: {
        "x-forwarded-host": host,
      },
    })

    const response = enforceTrustedOrigin(request)
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({
      code: "request_source_required",
      detail: "Request source is required.",
      status: 403,
    })
  })

  it("blocks browser-declared cross-site mutations", async () => {
    const { enforceTrustedOrigin } = await import("@/lib/security/route-guards")
    const host = faker.internet.domainName().toLowerCase()
    const request = createRequest(`https://${host}/api/contact`, {
      headers: {
        origin: `https://${host}`,
        "sec-fetch-site": "cross-site",
        "x-forwarded-host": host,
      },
    })

    const response = enforceTrustedOrigin(request)
    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toMatchObject({
      code: "cross_site_request",
      detail: "Cross-site requests are not allowed.",
      status: 403,
    })
  })

  it("applies per-ip rate limiting and includes retry-after", async () => {
    vi.stubEnv("RAILWAY_PROJECT_ID", "project-test")
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environment-test")
    vi.stubEnv("RAILWAY_SERVICE_ID", "service-test")
    const { enforceRateLimit } = await import("@/lib/security/route-guards")
    const endpoint = faker.internet.url()
    const request = createRequest(endpoint, {
      headers: {
        "x-real-ip": faker.internet.ip(),
      },
    })
    const max = faker.number.int({ min: 2, max: 4 })
    const policy = {
      key: faker.string.alphanumeric(12),
      max,
      windowMs: faker.number.int({ min: 15_000, max: 30_000 }),
      onUnavailable: "local-fallback" as const,
    }

    for (let index = 0; index < max; index += 1) {
      await expect(enforceRateLimit(request, policy)).resolves.toBeNull()
    }

    const blocked = await enforceRateLimit(request, policy)

    expect(blocked?.status).toBe(429)
    expect(blocked?.headers.get("Retry-After")).toBeTruthy()
  })

  it("isolates trusted Railway client IP buckets", async () => {
    vi.stubEnv("RAILWAY_PROJECT_ID", "project-test")
    vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "environment-test")
    vi.stubEnv("RAILWAY_SERVICE_ID", "service-test")
    const { enforceRateLimit } = await import("@/lib/security/route-guards")
    const key = faker.string.alphanumeric(10)
    const firstRequest = createRequest(faker.internet.url(), {
      headers: {
        "x-real-ip": faker.internet.ip(),
      },
    })
    const secondRequest = createRequest(faker.internet.url(), {
      headers: {
        "x-real-ip": faker.internet.ip(),
      },
    })
    const policy = {
      key,
      max: 1,
      windowMs: faker.number.int({ min: 1000, max: 5000 }),
      onUnavailable: "local-fallback" as const,
    }

    await expect(enforceRateLimit(firstRequest, policy)).resolves.toBeNull()
    expect((await enforceRateLimit(firstRequest, policy))?.status).toBe(429)
    await expect(enforceRateLimit(secondRequest, policy)).resolves.toBeNull()
  })

  it("resets rate limit counters after the window elapses", async () => {
    const { enforceRateLimit } = await import("@/lib/security/route-guards")
    const windowMs = faker.number.int({ min: 10_000, max: 20_000 })
    const policy = {
      key: faker.string.alphanumeric(9),
      max: 1,
      windowMs,
      onUnavailable: "local-fallback" as const,
    }
    const request = createRequest(faker.internet.url())

    await expect(enforceRateLimit(request, policy)).resolves.toBeNull()
    expect((await enforceRateLimit(request, policy))?.status).toBe(429)

    vi.advanceTimersByTime(windowMs + faker.number.int({ min: 1, max: 100 }))

    await expect(enforceRateLimit(request, policy)).resolves.toBeNull()
  })

  it("returns 415 for non-json payloads", async () => {
    const { parseJsonBody } = await import("@/lib/security/route-guards")
    const schema = z.object({ email: z.string().email() })
    const request = createRequest(faker.internet.url(), {
      headers: {
        "content-type": "text/plain",
      },
      body: faker.lorem.sentence(),
    })

    const result = await parseJsonBody(request, schema)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(415)
    }
  })

  it("returns 413 when content-length exceeds maxBytes", async () => {
    const { parseJsonBody } = await import("@/lib/security/route-guards")
    const body = JSON.stringify({ value: faker.string.alphanumeric(32) })
    const request = createRequest(faker.internet.url(), {
      headers: {
        "content-type": "application/json",
        "content-length": String(body.length + 100),
      },
      body,
    })

    const result = await parseJsonBody(
      request,
      z.object({ value: z.string() }),
      {
        maxBytes: body.length,
      }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(413)
    }
  })

  it("enforces the byte limit when content-length is absent", async () => {
    const { parseJsonBody } = await import("@/lib/security/route-guards")
    const body = JSON.stringify({ value: faker.string.alphanumeric(128) })
    const request = createRequest(faker.internet.url(), {
      headers: {
        "content-type": "application/json",
      },
      body,
    })

    const result = await parseJsonBody(
      request,
      z.object({ value: z.string() }),
      {
        maxBytes: 32,
      }
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(413)
    }
  })

  it("returns 400 for malformed json", async () => {
    const { parseJsonBody } = await import("@/lib/security/route-guards")
    const request = createRequest(faker.internet.url(), {
      headers: {
        "content-type": "application/json",
      },
      body: "{",
    })

    const result = await parseJsonBody(request, z.object({ ok: z.boolean() }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
    }
  })

  it("returns validation errors for invalid payload fields", async () => {
    const { parseJsonBody } = await import("@/lib/security/route-guards")
    const request = createRequest(faker.internet.url(), {
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        quantity: faker.number.int({ min: -10, max: -1 }),
      }),
    })

    const result = await parseJsonBody(
      request,
      z.object({
        quantity: z.number().int().positive(),
      })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
      await expect(result.response.json()).resolves.toMatchObject({
        code: "invalid_request",
        detail: "Invalid request body.",
        errors: [
          {
            field: "quantity",
          },
        ],
      })
    }
  })

  it("parses valid json and preserves no-store semantics", async () => {
    const { jsonApiError, jsonApiResponse, parseJsonBody } = await import(
      "@/lib/security/route-guards"
    )
    const schema = z.object({
      at: z.string().datetime(),
      amount: z.number().int().min(1),
    })
    const payload = {
      at: faker.date.recent().toISOString(),
      amount: faker.number.int({ min: 1, max: 50 }),
    }

    const parseResult = await parseJsonBody(
      createRequest(faker.internet.url(), {
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
      schema
    )

    expect(parseResult.ok).toBe(true)
    if (parseResult.ok) {
      expect(parseResult.data).toEqual(payload)
    }

    const success = jsonApiResponse({ ok: true }, { status: 201 })
    expect(success.status).toBe(201)
    expect(success.headers.get("Cache-Control")).toContain("no-store")

    const failure = jsonApiError(
      createRequest("https://storefront.test/api/failure"),
      "nope",
      500
    )
    expect(failure.status).toBe(500)
    expect(failure.headers.get("Cache-Control")).toContain("no-store")
  })

  it("logs client problems to stdout and server problems to stderr", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const infoLog = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined)
    const warningLog = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined)
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const { jsonApiError } = await import("@/lib/security/route-guards")
    const request = createRequest("https://storefront.test/api/failure")

    jsonApiError(request, "Invalid query", 400, "invalid_query")

    expect(infoLog).toHaveBeenCalledTimes(1)
    expect(warningLog).not.toHaveBeenCalled()
    expect(errorLog).not.toHaveBeenCalled()
    expect(JSON.parse(String(infoLog.mock.calls.at(0)?.at(0)))).toMatchObject({
      event: "api.problem",
      message: "Storefront API problem response",
      method: "POST",
      problem_code: "invalid_query",
      status: 400,
    })

    jsonApiError(request, "Request failed", 500, "request_failed")

    expect(errorLog).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(errorLog.mock.calls.at(0)?.at(0)))).toMatchObject({
      event: "api.problem",
      message: "Storefront API problem response",
      method: "POST",
      problem_code: "request_failed",
      status: 500,
    })
  })
})
