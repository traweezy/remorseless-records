import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { createPublicFormProof } from "../../../lib/public-forms/auth"
import type { PublicFormEmailSender } from "../../../lib/public-forms/email"

import { createContactPost } from "./route"

const secret = ["contact", "backend", "unit", "test", "key"].join("-").repeat(2)
const nowSeconds = 1_800_000_000
const submissionId = "11111111-2222-4333-8444-555555555555"

type ContactPayload = {
  name: string
  email: string
  reason: "booking" | "press" | "collab" | "other"
  message: string
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
  payload: ContactPayload,
  options?: { proof?: string; rawBody?: string }
): MedusaRequest => {
  const rawBody = options?.rawBody ?? JSON.stringify(payload)
  const proof =
    options?.proof ??
    createPublicFormProof({
      body: rawBody,
      purpose: "contact",
      secret,
      timestamp: nowSeconds,
    })
  return {
    body: payload,
    headers: {
      "x-request-id": "contact-backend-contract-test",
      "x-rr-form-proof": proof,
      "x-rr-form-timestamp": String(nowSeconds),
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    },
    path: "/store/contact",
    rawBody: Buffer.from(rawBody),
  } as unknown as MedusaRequest
}

const validPayload = (): ContactPayload => ({
  name: "Test Person",
  email: "person@example.com",
  reason: "booking",
  message: "Please send the booking information for this artist.",
  honeypot: "",
})

const createHandler = (
  sendEmail: PublicFormEmailSender | null,
  overrides?: { fromEmail?: string; formSecret?: string }
) =>
  createContactPost({
    createSubmissionId: () => submissionId,
    fromEmail: overrides?.fromEmail ?? "forms@example.com",
    nowSeconds: () => nowSeconds,
    secret: overrides?.formSecret ?? secret,
    sendEmail,
  })

describe("POST /store/contact", () => {
  it("sends a bounded, idempotent email for a valid BFF proof", async () => {
    const sendEmail = jest.fn<
      ReturnType<PublicFormEmailSender>,
      Parameters<PublicFormEmailSender>
    >(async () => undefined)
    const { res, state } = responseFixture()

    await createHandler(sendEmail)(requestFixture(validPayload()), res)

    expect(state).toEqual({ body: { ok: true }, headers: {}, status: 200 })
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "forms@example.com",
        replyTo: "person@example.com",
        subject: "[Contact] BOOKING",
        to: "forms@example.com",
      }),
      {
        idempotencyKey: `contact-${submissionId}`,
        signal: expect.any(AbortSignal),
      }
    )
  })

  it("rejects a missing or body-mismatched proof before email delivery", async () => {
    const sendEmail = jest.fn<
      ReturnType<PublicFormEmailSender>,
      Parameters<PublicFormEmailSender>
    >()
    const payload = validPayload()
    const { res, state } = responseFixture()

    await createHandler(sendEmail)(
      requestFixture(payload, {
        proof: createPublicFormProof({
          body: JSON.stringify({ ...payload, message: "A different message" }),
          purpose: "contact",
          secret,
          timestamp: nowSeconds,
        }),
      }),
      res
    )

    expect(state.status).toBe(401)
    expect(state.body).toMatchObject({
      code: "contact_unauthorized",
      request_id: "contact-backend-contract-test",
      status: 401,
      trace_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("returns bounded field errors for a signed invalid payload", async () => {
    const sendEmail = jest.fn<
      ReturnType<PublicFormEmailSender>,
      Parameters<PublicFormEmailSender>
    >()
    const payload = {
      ...validPayload(),
      email: "not-an-email",
      message: "short",
    }
    const { res, state } = responseFixture()

    await createHandler(sendEmail)(requestFixture(payload), res)

    expect(state.status).toBe(400)
    expect(state.body).toMatchObject({
      code: "invalid_contact_request",
      errors: expect.arrayContaining([
        expect.objectContaining({ field: "email" }),
        expect.objectContaining({ field: "message" }),
      ]),
      status: 400,
    })
    expect(JSON.stringify(state.body)).not.toContain("not-an-email")
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("silently accepts a signed honeypot payload", async () => {
    const sendEmail = jest.fn<
      ReturnType<PublicFormEmailSender>,
      Parameters<PublicFormEmailSender>
    >()
    const { res, state } = responseFixture()

    await createHandler(sendEmail)(
      requestFixture({ ...validPayload(), honeypot: "spam-company" }),
      res
    )

    expect(state).toEqual({ body: { ok: true }, headers: {}, status: 200 })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("redacts provider failures behind a retryable safe problem", async () => {
    const sendEmail = jest.fn<
      ReturnType<PublicFormEmailSender>,
      Parameters<PublicFormEmailSender>
    >(async () => {
      throw new Error("provider response contains a secret token")
    })
    const { res, state } = responseFixture()

    await createHandler(sendEmail)(requestFixture(validPayload()), res)

    expect(state.status).toBe(503)
    expect(state.body).toMatchObject({
      code: "contact_unavailable",
      detail: "Unable to send message right now.",
      status: 503,
    })
    expect(JSON.stringify(state.body)).not.toContain("secret token")
  })

  it.each([
    ["proof secret", { formSecret: "too-short" }, jest.fn()],
    ["email configuration", { fromEmail: "" }, null],
  ])(
    "fails closed when %s is unavailable",
    async (_label, overrides, sender) => {
      const { res, state } = responseFixture()

      await createHandler(sender as PublicFormEmailSender | null, overrides)(
        requestFixture(validPayload()),
        res
      )

      expect(state.status).toBe(503)
      expect(state.body).toMatchObject({
        code: "contact_unavailable",
        status: 503,
      })
    }
  )
})
