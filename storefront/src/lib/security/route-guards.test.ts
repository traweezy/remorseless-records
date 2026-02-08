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
    await expect(response?.json()).resolves.toEqual({
      error: "Request origin is not allowed.",
    })
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
    await expect(response?.json()).resolves.toEqual({
      error: "Request referer is not allowed.",
    })
  })

  it("uses configured site url as a trusted host", async () => {
    const { enforceTrustedOrigin } = await import("@/lib/security/route-guards")
    const trustedHost = faker.internet.domainName().toLowerCase()
    process.env.NEXT_PUBLIC_SITE_URL = `https://${trustedHost}`
    process.env.NEXT_PUBLIC_BASE_URL = `https://${faker.internet.domainName().toLowerCase()}`

    const request = createRequest(`https://${faker.internet.domainName().toLowerCase()}/api/contact`, {
      headers: {
        origin: `https://${trustedHost}`,
      },
    })

    expect(enforceTrustedOrigin(request)).toBeNull()
  })

  it("does not block when origin or referer headers are missing", async () => {
    const { enforceTrustedOrigin } = await import("@/lib/security/route-guards")
    const host = faker.internet.domainName().toLowerCase()
    const request = createRequest(`https://${host}/api/contact`, {
      headers: {
        "x-forwarded-host": host,
      },
    })

    expect(enforceTrustedOrigin(request)).toBeNull()
  })

  it("applies per-ip rate limiting and includes retry-after", async () => {
    const { enforceRateLimit } = await import("@/lib/security/route-guards")
    const endpoint = faker.internet.url()
    const request = createRequest(endpoint, {
      headers: {
        "x-forwarded-for": `${faker.internet.ip()}, ${faker.internet.ip()}`,
      },
    })
    const max = faker.number.int({ min: 2, max: 4 })
    const policy = {
      key: faker.string.alphanumeric(12),
      max,
      windowMs: faker.number.int({ min: 15_000, max: 30_000 }),
    }

    for (let index = 0; index < max; index += 1) {
      expect(enforceRateLimit(request, policy)).toBeNull()
    }

    const blocked = enforceRateLimit(request, policy)

    expect(blocked?.status).toBe(429)
    expect(blocked?.headers.get("Retry-After")).toBeTruthy()
  })

  it("uses x-real-ip and cf-connecting-ip fallbacks", async () => {
    const { enforceRateLimit } = await import("@/lib/security/route-guards")
    const key = faker.string.alphanumeric(10)

    const realIpRequest = createRequest(faker.internet.url(), {
      headers: {
        "x-real-ip": faker.internet.ip(),
      },
    })
    expect(
      enforceRateLimit(realIpRequest, { key, max: 1, windowMs: faker.number.int({ min: 1000, max: 5000 }) })
    ).toBeNull()
    expect(
      enforceRateLimit(realIpRequest, { key, max: 1, windowMs: faker.number.int({ min: 1000, max: 5000 }) })?.status
    ).toBe(429)

    const cfIpRequest = createRequest(faker.internet.url(), {
      headers: {
        "cf-connecting-ip": faker.internet.ip(),
      },
    })
    expect(
      enforceRateLimit(cfIpRequest, {
        key: `${key}-cf`,
        max: 1,
        windowMs: faker.number.int({ min: 1000, max: 5000 }),
      })
    ).toBeNull()
  })

  it("resets rate limit counters after the window elapses", async () => {
    const { enforceRateLimit } = await import("@/lib/security/route-guards")
    const windowMs = faker.number.int({ min: 10_000, max: 20_000 })
    const policy = {
      key: faker.string.alphanumeric(9),
      max: 1,
      windowMs,
    }
    const request = createRequest(faker.internet.url())

    expect(enforceRateLimit(request, policy)).toBeNull()
    expect(enforceRateLimit(request, policy)?.status).toBe(429)

    vi.advanceTimersByTime(windowMs + faker.number.int({ min: 1, max: 100 }))

    expect(enforceRateLimit(request, policy)).toBeNull()
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

    const result = await parseJsonBody(request, z.object({ value: z.string() }), {
      maxBytes: body.length,
    })

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
        error: "Invalid request body.",
      })
    }
  })

  it("parses valid json and preserves no-store semantics", async () => {
    const { jsonApiError, jsonApiResponse, parseJsonBody } = await import("@/lib/security/route-guards")
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

    const failure = jsonApiError("nope", 500)
    expect(failure.status).toBe(500)
    expect(failure.headers.get("Cache-Control")).toContain("no-store")
  })
})
