import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import refundIssuedHandler from "./refund-issued"

const handlerInput = ({
  collection,
  payment = {
    currency_code: "usd",
    id: "pay_01",
    payment_collection_id: "paycol_01",
    refunds: [
      {
        amount: 5,
        id: "refund_01",
        note: "Shipping adjustment",
      },
    ],
  },
}: {
  collection: Record<string, unknown>
  payment?: Record<string, unknown>
}) => {
  const createNotifications = jest.fn(async () => [])
  const graph = jest.fn(async () => ({ data: [collection] }))
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  }
  const dependencies = new Map<string, unknown>([
    [
      Modules.PAYMENT,
      {
        retrievePayment: jest.fn(async () => payment),
      },
    ],
    [ContainerRegistrationKeys.QUERY, { graph }],
    [Modules.NOTIFICATION, { createNotifications }],
    ["logger", logger],
  ])
  const input = {
    container: {
      resolve: (name: string) => dependencies.get(name),
    },
    event: {
      data: { id: "pay_01" },
      name: "payment.refunded",
    },
  } as unknown as Parameters<typeof refundIssuedHandler>[0]
  return {
    createNotifications,
    graph,
    input,
    logger,
  }
}

describe("payment refund notification subscriber", () => {
  it("creates an idempotent order notification without logging PII", async () => {
    const fixture = handlerInput({
      collection: {
        cart: { email: "fallback@example.com", id: "cart_01" },
        id: "paycol_01",
        order: {
          currency_code: "usd",
          customer_id: "cus_01",
          display_id: 42,
          email: "customer@example.com",
          id: "order_01",
        },
      },
    })

    await expect(refundIssuedHandler(fixture.input)).resolves.toBeUndefined()

    expect(fixture.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "payment_collection",
        filters: { id: "paycol_01" },
      })
    )
    expect(fixture.createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        idempotency_key: "refund-issued:refund_01",
        provider_data: {
          idempotency_key: "refund-issued:refund_01",
        },
        resource_id: "order_01",
        resource_type: "order",
        to: "customer@example.com",
      }),
    ])
    expect(fixture.logger.info).toHaveBeenCalledWith(
      expect.not.stringContaining("customer@example.com")
    )
  })

  it("uses the cart recipient when checkout compensation has no order", async () => {
    const fixture = handlerInput({
      collection: {
        cart: {
          currency_code: "usd",
          email: "guest@example.com",
          id: "cart_01",
        },
        id: "paycol_01",
        order: null,
      },
    })

    await refundIssuedHandler(fixture.input)

    expect(fixture.createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({
        data: expect.objectContaining({
          referenceLabel: "your checkout payment",
        }),
        resource_id: "cart_01",
        resource_type: "cart",
        to: "guest@example.com",
      }),
    ])
  })

  it("does not attempt an email when no recipient resource exists", async () => {
    const fixture = handlerInput({
      collection: { id: "paycol_01", order: null },
    })

    await refundIssuedHandler(fixture.input)

    expect(fixture.createNotifications).not.toHaveBeenCalled()
    expect(fixture.logger.warn).toHaveBeenCalledWith(
      expect.not.stringContaining("@")
    )
  })

  it("does no query or notification work when the payment has no refunds", async () => {
    const fixture = handlerInput({
      collection: {},
      payment: {
        currency_code: "usd",
        id: "pay_01",
        payment_collection_id: "paycol_01",
        refunds: [],
      },
    })

    await refundIssuedHandler(fixture.input)

    expect(fixture.graph).not.toHaveBeenCalled()
    expect(fixture.createNotifications).not.toHaveBeenCalled()
  })
})
