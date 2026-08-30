import {
  type CheckoutStatusQueryGraph,
  resolveInternalCheckoutStatus,
} from "./internal-status"

const queryFor = ({
  cart = {
    id: "cart_test",
    completed_at: null,
    payment_collection: { payment_sessions: [] },
  },
  orderId = null,
}: {
  cart?: Record<string, unknown> | null
  orderId?: string | null
} = {}): CheckoutStatusQueryGraph => ({
  graph: jest.fn(async ({ entity }) => {
    if (entity === "order_cart") {
      return { data: orderId ? [{ order_id: orderId }] : [] }
    }
    return { data: cart ? [cart] : [] }
  }),
})

describe("internal checkout status", () => {
  it("treats an order-cart link as in progress until completion returns", async () => {
    await expect(
      resolveInternalCheckoutStatus(
        queryFor({ orderId: "order_01K123ABC" }),
        "cart_01K123ABC"
      )
    ).resolves.toEqual({ state: "finalizing_order" })
  })

  it("reports a missing cart without exposing its identifier", async () => {
    await expect(
      resolveInternalCheckoutStatus(queryFor({ cart: null }), "cart_01K123ABC")
    ).resolves.toEqual({ state: "cart_missing" })
  })

  it.each([
    ["authorized", "finalizing_order"],
    ["captured", "finalizing_order"],
    ["pending_authorization", "payment_processing"],
    ["requires_more", "payment_action_required"],
    ["error", "payment_failed"],
    ["canceled", "payment_failed"],
    ["pending", "cart_active"],
  ] as const)("maps Stripe session %s to %s", async (status, state) => {
    const query = queryFor({
      cart: {
        id: "cart_test",
        payment_collection: {
          payment_sessions: [
            {
              provider_id: "pp_stripe_stripe",
              status,
            },
          ],
        },
      },
    })

    await expect(
      resolveInternalCheckoutStatus(query, "cart_01K123ABC")
    ).resolves.toEqual({ state })
  })

  it("confirms only a linked order whose cart is completed", async () => {
    const query = queryFor({
      orderId: "order_01K123ABC",
      cart: {
        id: "cart_01K123ABC",
        completed_at: "2026-07-25T17:00:00.000Z",
      },
    })

    await expect(
      resolveInternalCheckoutStatus(query, "cart_01K123ABC")
    ).resolves.toEqual({
      state: "order_confirmed",
      orderId: "order_01K123ABC",
    })
  })

  it("ignores sessions from other payment providers", async () => {
    const query = queryFor({
      cart: {
        id: "cart_test",
        payment_collection: {
          payment_sessions: [{ provider_id: "pp_other", status: "captured" }],
        },
      },
    })

    await expect(
      resolveInternalCheckoutStatus(query, "cart_01K123ABC")
    ).resolves.toEqual({ state: "cart_active" })
  })

  it("treats a completed cart without a visible link as finalizing", async () => {
    await expect(
      resolveInternalCheckoutStatus(
        queryFor({
          cart: {
            id: "cart_test",
            completed_at: "2026-07-25T12:00:00.000Z",
          },
        }),
        "cart_01K123ABC"
      )
    ).resolves.toEqual({ state: "finalizing_order" })
  })
})
