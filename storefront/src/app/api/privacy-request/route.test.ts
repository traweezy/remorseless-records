import { faker } from "@faker-js/faker"
import { beforeEach, describe, expect, it, vi } from "vitest"

type PrivacyPayload = {
  name: string
  email: string
  requestType: "access" | "delete" | "correct" | "optout" | "other"
  details: string
  orderId?: string
  honeypot?: string
}

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
    },
    body: JSON.stringify(payload),
  })

describe("privacy request route", () => {
  beforeEach(() => {
    faker.seed(9911)
    vi.restoreAllMocks()
  })

  it("forwards valid requests to backend store endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )

    const payload: PrivacyPayload = {
      name: faker.person.fullName(),
      email: faker.internet.email(),
      requestType: "access",
      details: faker.lorem.sentences(faker.number.int({ min: 2, max: 4 })),
      orderId: faker.string.alphanumeric(12),
      honeypot: "",
    }
    const { POST } = await import("@/app/api/privacy-request/route")
    const response = await POST(createRequest(payload))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("/store/privacy-request")
  })

  it("silently accepts honeypot payloads without backend forwarding", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    const payload: PrivacyPayload = {
      name: faker.person.fullName(),
      email: faker.internet.email(),
      requestType: "delete",
      details: faker.lorem.sentences(faker.number.int({ min: 2, max: 3 })),
      honeypot: faker.company.name(),
    }
    const { POST } = await import("@/app/api/privacy-request/route")
    const response = await POST(createRequest(payload))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("maps backend failures to a gateway error response", async () => {
    const errorMessage = faker.lorem.sentence()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: errorMessage }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      })
    )

    const payload: PrivacyPayload = {
      name: faker.person.fullName(),
      email: faker.internet.email(),
      requestType: "correct",
      details: faker.lorem.sentences(faker.number.int({ min: 2, max: 3 })),
      honeypot: "",
    }
    const { POST } = await import("@/app/api/privacy-request/route")
    const response = await POST(createRequest(payload))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ message: errorMessage })
  })

  it("rejects invalid payloads before any backend call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
    const { POST } = await import("@/app/api/privacy-request/route")
    const response = await POST(
      createRequest({
        name: faker.person.firstName(),
        email: faker.string.alpha(12),
        requestType: "other",
        details: faker.string.alpha(5),
        honeypot: "",
      })
    )

    expect(response.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
