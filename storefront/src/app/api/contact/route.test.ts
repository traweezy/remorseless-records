import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createContactPost } from "@/features/public-forms/server/contact-handler"

type ContactPayload = {
  name: string
  email: string
  reason: "booking" | "press" | "collab" | "other"
  message: string
  honeypot?: string
}

const traceId = "fedcba9876543210fedcba9876543210"
const timestamp = 1_800_000_000
const secret = ["contact", "form", "unit", "test", "key"].join("-").repeat(2)

const createRequest = (payload: ContactPayload): Request =>
  new Request("https://storefront.test/api/contact", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://storefront.test",
      referer: "https://storefront.test/contact",
      host: "storefront.test",
      "x-forwarded-host": "storefront.test",
      "x-forwarded-for": faker.internet.ip(),
      "x-request-id": "request_contact_01",
      traceparent: `00-${traceId}-0123456789abcdef-01`,
    },
    body: JSON.stringify(payload),
  })

const createHandler = (
  fetchImpl: typeof fetch,
  formSecret: string | null = secret
) =>
  createContactPost({
    backendBase: "https://backend.test",
    fetchImpl,
    nowSeconds: () => timestamp,
    publishableKey: "pk_test_public",
    secret: formSecret,
  })

const validPayload = (): ContactPayload => ({
  name: faker.person.fullName(),
  email: faker.internet.email(),
  reason: "booking",
  message: faker.lorem.sentences(faker.number.int({ min: 2, max: 4 })),
  honeypot: "",
})

describe("contact route", () => {
  beforeEach(() => {
    faker.seed(2255)
    vi.restoreAllMocks()
  })

  it("forwards a body-bound, purpose-bound proof to Backend", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    const response = await createHandler(fetchImpl)(
      createRequest(validPayload())
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    const options = fetchImpl.mock.calls[0]?.[1]
    const upstreamHeaders = new Headers(options?.headers)
    expect(upstreamHeaders.get("x-request-id")).toBe("request_contact_01")
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
      code: "contact_unavailable",
      status: 503,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("redacts Backend and network failures", async () => {
    const providerDetail = faker.lorem.sentence()
    const backendFailure = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: providerDetail }), {
          status: 503,
        })
      )
    const backendResponse = await createHandler(backendFailure)(
      createRequest(validPayload())
    )
    expect(backendResponse.status).toBe(502)
    expect(JSON.stringify(await backendResponse.json())).not.toContain(
      providerDetail
    )

    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined)
    const networkFailure = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(providerDetail))
    const networkResponse = await createHandler(networkFailure)(
      createRequest(validPayload())
    )
    expect(networkResponse.status).toBe(502)
    expect(JSON.stringify(await networkResponse.json())).not.toContain(
      providerDetail
    )
    expect(errorSpy).toHaveBeenCalledWith("[contact] Backend request failed")
  })

  it("maps upstream timeouts to a safe gateway-timeout problem", async () => {
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
      code: "contact_upstream_timeout",
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
        reason: "other",
        message: faker.string.alpha(5),
        honeypot: "",
      })
    )

    expect(response.status).toBe(400)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
