import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"

import { createCheckoutStatusProof } from "../../../../lib/checkout/internal-status-auth"

import { POST } from "./route"

const secret = ["unit", "test", "checkout", "key"].join("-").repeat(2)
const cartId = "cart_01K123ABC"
const originalSecret = process.env.CHECKOUT_BFF_SECRET

type ResponseState = {
  status: number
  contentType: string | null
  headers: Record<string, string>
  body: unknown
}

const responseFixture = (): {
  res: MedusaResponse
  state: ResponseState
} => {
  const state: ResponseState = {
    status: 200,
    contentType: null,
    headers: {},
    body: null,
  }
  const response = {} as MedusaResponse
  response.setHeader = jest.fn(
    (name: string, value: string): MedusaResponse => {
      state.headers[name.toLowerCase()] = value
      return response
    }
  ) as MedusaResponse["setHeader"]
  response.status = jest.fn((status: number): MedusaResponse => {
    state.status = status
    return response
  }) as MedusaResponse["status"]
  response.type = jest.fn((contentType: string): MedusaResponse => {
    state.contentType = contentType
    return response
  }) as MedusaResponse["type"]
  response.json = jest.fn((body: unknown): MedusaResponse => {
    state.body = body
    return response
  }) as MedusaResponse["json"]
  return { res: response, state }
}

const requestFixture = ({
  body = { cart_id: cartId },
  proof,
  timestamp,
  resolve = jest.fn(),
}: {
  body?: unknown
  proof?: string
  timestamp?: number
  resolve?: jest.Mock
} = {}): MedusaStoreRequest =>
  ({
    body,
    headers: {
      ...(proof ? { "x-rr-checkout-proof": proof } : {}),
      ...(timestamp ? { "x-rr-checkout-timestamp": String(timestamp) } : {}),
    },
    scope: { resolve },
  }) as unknown as MedusaStoreRequest

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.CHECKOUT_BFF_SECRET
  } else {
    process.env.CHECKOUT_BFF_SECRET = originalSecret
  }
})

describe("POST /store/checkout/status", () => {
  it("fails closed when the BFF secret is not configured", async () => {
    delete process.env.CHECKOUT_BFF_SECRET
    const { res, state } = responseFixture()

    await POST(requestFixture(), res)

    expect(state).toMatchObject({
      status: 503,
      contentType: "application/problem+json",
      headers: { "cache-control": "no-store" },
      body: { code: "checkout_status_unavailable" },
    })
  })

  it("rejects invalid or missing proofs without querying checkout data", async () => {
    process.env.CHECKOUT_BFF_SECRET = secret
    const resolve = jest.fn()
    const { res, state } = responseFixture()

    await POST(requestFixture({ resolve }), res)

    expect(state).toMatchObject({
      status: 401,
      contentType: "application/problem+json",
      headers: { "cache-control": "no-store" },
      body: { code: "checkout_status_unauthorized" },
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it("returns only the internal recovery projection for a valid proof", async () => {
    process.env.CHECKOUT_BFF_SECRET = secret
    const timestamp = Math.floor(Date.now() / 1000)
    const proof = createCheckoutStatusProof({ cartId, timestamp, secret })
    const graph = jest.fn(async ({ entity }: { entity: string }) =>
      entity === "order_cart"
        ? { data: [{ order_id: "order_01K123ABC" }] }
        : { data: [{ id: cartId }] }
    )
    const resolve = jest.fn(() => ({ graph }))
    const { res, state } = responseFixture()

    await POST(requestFixture({ proof, timestamp, resolve }), res)

    expect(state).toEqual({
      status: 200,
      contentType: null,
      headers: { "cache-control": "no-store" },
      body: { state: "finalizing_order" },
    })
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it("maps query failures to a safe retryable problem", async () => {
    process.env.CHECKOUT_BFF_SECRET = secret
    const timestamp = Math.floor(Date.now() / 1000)
    const proof = createCheckoutStatusProof({ cartId, timestamp, secret })
    const resolve = jest.fn(() => ({
      graph: jest.fn(async () => {
        throw new Error(`sensitive failure for ${cartId}`)
      }),
    }))
    const { res, state } = responseFixture()

    await POST(requestFixture({ proof, timestamp, resolve }), res)

    expect(state).toMatchObject({
      status: 503,
      contentType: "application/problem+json",
      headers: { "cache-control": "no-store" },
      body: {
        code: "checkout_status_unavailable",
        detail: "Checkout status could not be resolved. Try again shortly.",
      },
    })
    expect(JSON.stringify(state.body)).not.toContain(cartId)
  })
})
