import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { createPublicFormProof } from "../../../lib/public-forms/auth"
import type { PublicFormEmailSender } from "../../../lib/public-forms/email"

import { createPrivacyRequestPost } from "./route"

const secret = ["privacy", "backend", "unit", "test", "key"].join("-").repeat(2)
const now = new Date("2027-01-15T08:00:00.000Z")
const nowSeconds = Math.floor(now.getTime() / 1000)
const requestId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

type PrivacyPayload = {
  name: string
  email: string
  requestType: "access" | "delete" | "correct" | "optout" | "other"
  details: string
  orderId?: string
  honeypot?: string
}

type ResponseState = {
  body: unknown
  headers: Record<string, string>
  status: number
}

const responseFixture = (): {
  res: MedusaResponse
  state: ResponseState
} => {
  const state: ResponseState = { body: null, headers: {}, status: 200 }
  const response = { locals: {} } as MedusaResponse
  response.setHeader = jest.fn((name: string, value: string) => {
    state.headers[name.toLowerCase()] = value
    return response
  }) as MedusaResponse["setHeader"]
  response.type = jest.fn((value: string) => {
    state.headers["content-type"] = value
    return response
  }) as MedusaResponse["type"]
  response.status = jest.fn((status: number) => {
    state.status = status
    return response
  }) as MedusaResponse["status"]
  response.json = jest.fn((body: unknown) => {
    state.body = body
    return response
  }) as MedusaResponse["json"]
  return { res: response, state }
}

const requestFixture = (
  payload: PrivacyPayload,
  purpose: "contact" | "privacy-request" = "privacy-request"
): MedusaRequest => {
  const rawBody = JSON.stringify(payload)
  return {
    body: payload,
    headers: {
      "x-request-id": "privacy-backend-contract-test",
      "x-rr-form-proof": createPublicFormProof({
        body: rawBody,
        purpose,
        secret,
        timestamp: nowSeconds,
      }),
      "x-rr-form-timestamp": String(nowSeconds),
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
    },
    path: "/store/privacy-request",
    rawBody: Buffer.from(rawBody),
  } as unknown as MedusaRequest
}

const validPayload = (): PrivacyPayload => ({
  name: "Privacy Customer",
  email: "privacy@example.com",
  requestType: "access",
  details: "Please provide a copy of the personal data for this account.",
  orderId: "order_01TEST",
  honeypot: "",
})

const createHandler = (sendEmail: PublicFormEmailSender | null) =>
  createPrivacyRequestPost({
    createSubmissionId: () => requestId,
    fromEmail: "privacy-ops@example.com",
    now: () => now,
    secret,
    sendEmail,
  })

describe("POST /store/privacy-request", () => {
  it("sends a bounded request record and returns its opaque ID", async () => {
    const sendEmail = jest.fn<
      ReturnType<PublicFormEmailSender>,
      Parameters<PublicFormEmailSender>
    >(async () => undefined)
    const { res, state } = responseFixture()

    await createHandler(sendEmail)(requestFixture(validPayload()), res)

    expect(state).toEqual({
      body: { ok: true, request_id: requestId },
      headers: {},
      status: 200,
    })
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "privacy-ops@example.com",
        replyTo: "privacy@example.com",
        subject: `[Privacy Request] ACCESS (${requestId})`,
        text: expect.stringContaining(`Request ID: ${requestId}`),
        to: "privacy-ops@example.com",
      }),
      {
        idempotencyKey: `privacy-request-${requestId}`,
        signal: expect.any(AbortSignal),
      }
    )
  })

  it("prevents a contact proof from being replayed for privacy", async () => {
    const sendEmail = jest.fn<
      ReturnType<PublicFormEmailSender>,
      Parameters<PublicFormEmailSender>
    >()
    const { res, state } = responseFixture()

    await createHandler(sendEmail)(
      requestFixture(validPayload(), "contact"),
      res
    )

    expect(state.status).toBe(401)
    expect(state.body).toMatchObject({
      code: "privacy_request_unauthorized",
      request_id: "privacy-backend-contract-test",
      status: 401,
      trace_id: "11111111111111111111111111111111",
    })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("returns bounded field errors for signed invalid input", async () => {
    const sendEmail = jest.fn<
      ReturnType<PublicFormEmailSender>,
      Parameters<PublicFormEmailSender>
    >()
    const payload = {
      ...validPayload(),
      details: "short",
      email: "private-value-that-is-not-an-email",
    }
    const { res, state } = responseFixture()

    await createHandler(sendEmail)(requestFixture(payload), res)

    expect(state.status).toBe(400)
    expect(state.body).toMatchObject({
      code: "invalid_privacy_request",
      errors: expect.arrayContaining([
        expect.objectContaining({ field: "details" }),
        expect.objectContaining({ field: "email" }),
      ]),
      status: 400,
    })
    expect(JSON.stringify(state.body)).not.toContain("private-value")
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("silently accepts a signed honeypot request", async () => {
    const sendEmail = jest.fn<
      ReturnType<PublicFormEmailSender>,
      Parameters<PublicFormEmailSender>
    >()
    const { res, state } = responseFixture()

    await createHandler(sendEmail)(
      requestFixture({ ...validPayload(), honeypot: "automated-spam" }),
      res
    )

    expect(state).toEqual({ body: { ok: true }, headers: {}, status: 200 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("redacts email provider failures", async () => {
    const sendEmail = jest.fn<
      ReturnType<PublicFormEmailSender>,
      Parameters<PublicFormEmailSender>
    >(async () => {
      throw new Error("provider included customer data and an API key")
    })
    const { res, state } = responseFixture()

    await createHandler(sendEmail)(requestFixture(validPayload()), res)

    expect(state.status).toBe(503)
    expect(state.body).toMatchObject({
      code: "privacy_request_unavailable",
      detail: "Unable to submit privacy request right now.",
      status: 503,
    })
    expect(JSON.stringify(state.body)).not.toContain("customer data")
    expect(JSON.stringify(state.body)).not.toContain("API key")
  })

  it("fails closed when email delivery is not configured", async () => {
    const { res, state } = responseFixture()

    await createHandler(null)(requestFixture(validPayload()), res)

    expect(state.status).toBe(503)
    expect(state.body).toMatchObject({
      code: "privacy_request_unavailable",
      status: 503,
    })
  })
})
