import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

jest.mock("@/lib/constants", () => ({
  STRIPE_API_KEY: "sk_test_subscriber_boundary",
}))

import stripeOrderSyncHandler from "./stripe-order-sync"

const handlerInput = (
  graphResult: unknown,
  eventData: unknown = { id: "order_01" }
) => {
  const graph = jest.fn(async () => graphResult)
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
  }
  const dependencies = new Map<string, unknown>([
    [ContainerRegistrationKeys.QUERY, { graph }],
    [ContainerRegistrationKeys.LOGGER, logger],
  ])
  const input = {
    container: {
      resolve: (name: string) => dependencies.get(name),
    },
    event: {
      data: eventData,
      name: "order.placed",
    },
  } as unknown as Parameters<typeof stripeOrderSyncHandler>[0]
  return { graph, input, logger }
}

const nonStripeOrder = (overrides: Record<string, unknown> = {}) => ({
  display_id: 42,
  id: "order_01",
  payment_collections: [
    {
      payment_sessions: [
        { provider_id: "pp_system", data: { id: "system_01" } },
      ],
    },
  ],
  ...overrides,
})

describe("Stripe order sync subscriber boundary", () => {
  it("does no provider work for a complete non-Stripe order", async () => {
    const fixture = handlerInput({ data: [nonStripeOrder()] })

    await expect(stripeOrderSyncHandler(fixture.input)).resolves.toBeUndefined()
    expect(fixture.graph).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.arrayContaining([
          "payment_collections.payments.authorized_at",
          "payment_collections.payments.status",
        ]),
        filters: { id: "order_01" },
        pagination: { take: 1 },
      })
    )
    expect(fixture.logger.info).not.toHaveBeenCalled()
  })

  it("rejects a malformed event envelope before querying", async () => {
    const fixture = handlerInput({ data: [nonStripeOrder()] }, null)

    await expect(stripeOrderSyncHandler(fixture.input)).rejects.toThrow(
      "Stripe order sync received an invalid order identity"
    )
    expect(fixture.graph).not.toHaveBeenCalled()
  })

  it.each([
    ["primitive row", { data: [false] }],
    ["missing row", { data: [] }],
    ["ambiguous row", { data: [nonStripeOrder(), nonStripeOrder()] }],
    ["mismatched identity", { data: [nonStripeOrder({ id: "order_other" })] }],
  ])("rejects a %s", async (_label, graphResult) => {
    const fixture = handlerInput(graphResult)

    await expect(stripeOrderSyncHandler(fixture.input)).rejects.toThrow(
      "Stripe order sync returned an invalid order projection"
    )
  })

  it("rejects a coercive order number", async () => {
    const fixture = handlerInput({
      data: [nonStripeOrder({ display_id: false })],
    })

    await expect(stripeOrderSyncHandler(fixture.input)).rejects.toThrow(
      "Stripe order sync requires an order number"
    )
  })

  it("rejects a malformed Stripe relationship instead of hiding it", async () => {
    const fixture = handlerInput({
      data: [
        nonStripeOrder({
          payment_collections: [
            {
              payment_sessions: [
                {
                  data: { id: "not-a-payment-intent" },
                  provider_id: "pp_stripe_stripe",
                },
              ],
            },
          ],
        }),
      ],
    })

    await expect(stripeOrderSyncHandler(fixture.input)).rejects.toThrow(
      "Stripe order payment projection is malformed"
    )
  })
})
