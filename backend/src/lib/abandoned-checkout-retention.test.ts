import type {
  ICartModuleService,
  ILockingModule,
} from "@medusajs/framework/types"

import {
  type AbandonedCheckoutQuery,
  type AbandonedCheckoutRetentionConfig,
  removeAbandonedGuestCheckouts,
  resolveAbandonedCheckoutRetentionConfig,
} from "./abandoned-checkout-retention"

const config: AbandonedCheckoutRetentionConfig = {
  enabled: true,
  retentionDays: 37,
  maxDeletionsPerRun: 250,
}

type RecordFixture = Record<string, unknown>

const cart = (overrides: RecordFixture = {}): RecordFixture => ({
  id: "cart_abandoned",
  email: "buyer@example.test",
  customer_id: null,
  completed_at: null,
  updated_at: "2026-01-01T00:00:00.000Z",
  payment_collection: null,
  ...overrides,
})

const services = ({
  carts,
  orderCartIds = [],
}: {
  carts: RecordFixture[]
  orderCartIds?: string[]
}) => {
  let activeCarts = [...carts]
  const graph = jest.fn(
    async ({
      entity,
      filters,
      pagination,
    }: {
      entity: string
      filters?: Record<string, unknown>
      pagination?: { skip?: number; take?: number }
    }) => {
      if (entity === "order_cart") {
        const cartId = filters?.cart_id
        return {
          data:
            typeof cartId === "string" && orderCartIds.includes(cartId)
              ? [{ order_id: "order_linked" }]
              : [],
        }
      }
      const id = filters?.id
      if (typeof id === "string") {
        return {
          data: activeCarts.filter((value) => value.id === id),
        }
      }
      const skip = pagination?.skip ?? 0
      const take = pagination?.take ?? 100
      return { data: activeCarts.slice(skip, skip + take) }
    }
  )
  const deleteCarts = jest.fn(async (ids: string[]) => {
    activeCarts = activeCarts.filter((value) => !ids.includes(String(value.id)))
  })
  const execute = jest.fn(
    async (_keys: string | string[], job: () => Promise<unknown>) => job()
  )
  const cancelPaymentSessions = jest.fn(async () => undefined)

  return {
    query: { graph } as AbandonedCheckoutQuery,
    cartService: {
      deleteCarts,
    } as unknown as Pick<ICartModuleService, "deleteCarts">,
    lockingService: {
      execute,
    } as Pick<ILockingModule, "execute">,
    cancelPaymentSessions,
  }
}

describe("abandoned checkout retention", () => {
  it("defaults to a disabled 37-day policy", () => {
    expect(resolveAbandonedCheckoutRetentionConfig({})).toEqual({
      enabled: false,
      retentionDays: 37,
      maxDeletionsPerRun: 250,
    })
  })

  it("refuses a retention period shorter than the cart-cookie grace window", () => {
    expect(() =>
      resolveAbandonedCheckoutRetentionConfig({
        ABANDONED_CHECKOUT_RETENTION_DAYS: "30",
      })
    ).toThrow("between 37 and 365")
  })

  it("deletes an old guest checkout with no payment state", async () => {
    const fixture = services({ carts: [cart()] })

    const result = await removeAbandonedGuestCheckouts({
      ...fixture,
      config,
      now: new Date("2026-07-25T00:00:00.000Z"),
    })

    expect(fixture.cartService.deleteCarts).toHaveBeenCalledWith([
      "cart_abandoned",
    ])
    expect(fixture.cancelPaymentSessions).not.toHaveBeenCalled()
    expect(result.deleted).toBe(1)
  })

  it("cancels an unused collection before deleting its cart", async () => {
    const fixture = services({
      carts: [
        cart({
          payment_collection: {
            id: "paycol_unused",
            status: "awaiting",
            payment_sessions: [{ id: "payses_unused", status: "pending" }],
          },
        }),
      ],
    })

    const result = await removeAbandonedGuestCheckouts({
      ...fixture,
      config,
    })

    expect(fixture.cancelPaymentSessions).toHaveBeenCalledWith([
      "payses_unused",
    ])
    const cancellationOrder =
      fixture.cancelPaymentSessions.mock.invocationCallOrder[0]
    const deletionOrder = (fixture.cartService.deleteCarts as jest.Mock).mock
      .invocationCallOrder[0]
    if (cancellationOrder === undefined || deletionOrder === undefined) {
      throw new Error("Expected cancellation and deletion calls")
    }
    expect(cancellationOrder).toBeLessThan(deletionOrder)
    expect(result).toMatchObject({
      deleted: 1,
      paymentCollectionsCanceled: 1,
    })
  })

  it.each([
    ["authorized", "authorized"],
    ["captured", "captured"],
    ["authentication", "requires_more"],
    ["processing", "pending_authorization"],
    ["unknown", "future_status"],
  ])("protects %s payment state", async (_label, status) => {
    const fixture = services({
      carts: [
        cart({
          payment_collection: {
            id: "paycol_protected",
            status: "awaiting",
            payment_sessions: [{ id: "payses_protected", status }],
          },
        }),
      ],
    })

    const result = await removeAbandonedGuestCheckouts({
      ...fixture,
      config,
    })

    expect(fixture.cartService.deleteCarts).not.toHaveBeenCalled()
    expect(fixture.cancelPaymentSessions).not.toHaveBeenCalled()
    expect(result.protectedByPayment).toBe(1)
  })

  it("protects a checkout linked to an order", async () => {
    const fixture = services({
      carts: [cart()],
      orderCartIds: ["cart_abandoned"],
    })

    const result = await removeAbandonedGuestCheckouts({
      ...fixture,
      config,
    })

    expect(fixture.cartService.deleteCarts).not.toHaveBeenCalled()
    expect(result.protectedByOrder).toBe(1)
  })

  it("rechecks eligibility inside the cart lock", async () => {
    const fixture = services({ carts: [cart()] })
    fixture.query.graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [cart()] })
      .mockResolvedValueOnce({
        data: [cart({ customer_id: "cus_claimed" })],
      })

    const result = await removeAbandonedGuestCheckouts({
      ...fixture,
      config,
    })

    expect(fixture.cartService.deleteCarts).not.toHaveBeenCalled()
    expect(result.deleted).toBe(0)
  })

  it("protects a checkout resumed after it was listed for cleanup", async () => {
    const fixture = services({ carts: [cart()] })
    fixture.query.graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [cart()] })
      .mockResolvedValueOnce({
        data: [
          cart({
            updated_at: "2026-07-24T23:59:59.000Z",
          }),
        ],
      })

    const result = await removeAbandonedGuestCheckouts({
      ...fixture,
      config,
      now: new Date("2026-07-25T00:00:00.000Z"),
    })

    expect(fixture.cartService.deleteCarts).not.toHaveBeenCalled()
    expect(fixture.cancelPaymentSessions).not.toHaveBeenCalled()
    expect(result.deleted).toBe(0)
  })
})
