import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createPrivacyRequestPost } from "@/features/public-forms/server/privacy-request-handler"

type PrivacyPayload = {
  name: string
  email: string
  requestType: "access" | "delete" | "correct" | "optout" | "other"
  details: string
  orderId?: string
  honeypot?: string
}

const traceId = "0123456789abcdef0123456789abcdef"
const timestamp = 1_800_000_000
const secret = ["privacy", "form", "unit", "test", "key"].join("-").repeat(2)
const upstreamRequestId = "8f42db79-1539-47f2-a0d7-2bf0d620bc88"

const createRequest = (payload: PrivacyPayload): Request =>
  new Request("https://storefront.test/api/privacy-request", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://storefront.test",
      referer: "https://storefront.test/privacy",
      host: "storefront.test",
      "x-forwarded-host": "storefront.test",
      "x-forwarded-for": faker.internet.ip(),
      "x-request-id": "request_privacy_01",
      traceparent: `00-${traceId}-0123456789abcdef-01`,
    },
    body: JSON.stringify(payload),
  })

const createHandler = (
  fetchImpl: typeof fetch,
  formSecret: string | null = secret
) =>
  createPrivacyRequestPost({
    backendBase: "https://backend.test",
    fetchImpl,
    nowSeconds: () => timestamp,
    publishableKey: "pk_test_public",
    secret: formSecret,
  })

const validPayload = (): PrivacyPayload => ({
  name: faker.person.fullName(),
  email: faker.internet.email(),
  requestType: "access",
  details: faker.lorem.sentences(faker.number.int({ min: 2, max: 4 })),
  orderId: faker.string.alphanumeric(12),
  honeypot: "",
})

describe("privacy request route", () => {
  beforeEach(() => {
    faker.seed(9911)
    vi.restoreAllMocks()
  })

  it("forwards a body-bound, purpose-bound proof to Backend", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, request_id: upstreamRequestId }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    )
    const response = await createHandler(fetchImpl)(
      createRequest(validPayload())
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      requestId: upstreamRequestId,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toEqual(
      new URL("https://backend.test/store/privacy-request")
    )
    const options = fetchImpl.mock.calls[0]?.[1]
    const upstreamHeaders = new Headers(options?.headers)
    expect(upstreamHeaders.get("x-request-id")).toBe("request_privacy_01")
    expect(upstreamHeaders.get("traceparent")).toMatch(
      new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`)
    )
    expect(upstreamHeaders.get("x-rr-form-timestamp")).toBe(String(timestamp))
    expect(upstreamHeaders.get("x-rr-form-proof")).toMatch(
      /^[A-Za-z0-9_-]{43}$/
    )
    expect(options?.signal).toBeInstanceOf(AbortSignal)
  })

  it("silently accepts honeypot payloads without Backend forwarding", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const response = await createHandler(fetchImpl)(
      createRequest({ ...validPayload(), honeypot: faker.company.name() })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("fails closed when the server-only proof secret is unavailable", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const response = await createHandler(
      fetchImpl,
      null
    )(createRequest(validPayload()))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      code: "privacy_request_unavailable",
      status: 503,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("maps Backend failures to a redacted gateway problem", async () => {
    const providerDetail = faker.lorem.sentence()
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: providerDetail }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })
    )
    const response = await createHandler(fetchImpl)(
      createRequest(validPayload())
    )

    expect(response.status).toBe(502)
    const problem: unknown = await response.json()
    expect(problem).toMatchObject({
      code: "privacy_request_upstream_unavailable",
      detail: "Unable to submit privacy request right now.",
      status: 502,
    })
    expect(JSON.stringify(problem)).not.toContain(providerDetail)
  })

  it("rejects malformed Backend success responses without inventing a reference", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, request_id: "not-an-id" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )

    const response = await createHandler(fetchImpl)(
      createRequest(validPayload())
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      code: "privacy_request_upstream_invalid",
      detail: "Unable to confirm privacy request submission right now.",
      status: 502,
    })
  })

  it("bounds oversized Backend success responses", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ value: "x".repeat(4_096) }))
      )

    const response = await createHandler(fetchImpl)(
      createRequest(validPayload())
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      code: "privacy_request_upstream_invalid",
      status: 502,
    })
  })

  it("distinguishes an upstream timeout without exposing its error", async () => {
    const timeoutDetail = faker.lorem.sentence()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException(timeoutDetail, "TimeoutError"))
    const response = await createHandler(fetchImpl)(
      createRequest(validPayload())
    )

    expect(response.status).toBe(504)
    const problem: unknown = await response.json()
    expect(problem).toMatchObject({
      code: "privacy_request_upstream_timeout",
      status: 504,
    })
    expect(JSON.stringify(problem)).not.toContain(timeoutDetail)
  })

  it("rejects invalid payloads before any Backend call", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const response = await createHandler(fetchImpl)(
      createRequest({
        name: faker.person.firstName(),
        email: faker.string.alpha(12),
        requestType: "other",
        details: faker.string.alpha(5),
        honeypot: "",
      })
    )

    expect(response.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
