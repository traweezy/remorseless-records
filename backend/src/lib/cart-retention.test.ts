import type { CartDTO } from "@medusajs/framework/types"

import {
  removeExpiredAnonymousCarts,
  resolveCartRetentionConfig,
  type CartRetentionConfig,
} from "./cart-retention"

const config: CartRetentionConfig = {
  enabled: true,
  retentionDays: 37,
  maxDeletionsPerRun: 1_000,
}

const cart = (overrides: Partial<CartDTO> = {}): CartDTO =>
  ({
    id: "cart_anonymous",
    currency_code: "usd",
    ...overrides,
  }) as CartDTO

const createServices = (pages: CartDTO[][]) => {
  let activeCarts = pages.flat()
  const listCarts = jest
    .fn()
    .mockImplementation(
      (
        filters: { id?: string[] },
        options: { skip?: number; take?: number }
      ) => {
        if (filters.id) {
          const candidates = activeCarts.filter(({ id }) =>
            filters.id?.includes(id)
          )
          return Promise.resolve(candidates)
        }
        const start = options.skip ?? 0
        return Promise.resolve(
          activeCarts.slice(start, start + (options.take ?? 250))
        )
      }
    )
  const deleteCarts = jest.fn().mockImplementation((ids: string[]) => {
    activeCarts = activeCarts.filter(({ id }) => !ids.includes(id))
    return Promise.resolve()
  })
  const execute = jest
    .fn()
    .mockImplementation(
      (_keys: string | string[], job: () => Promise<unknown>) => job()
    )

  return {
    cartService: { deleteCarts, listCarts },
    lockingService: { execute },
  }
}

describe("anonymous cart retention", () => {
  it("defaults to a disabled 37-day policy", () => {
    expect(resolveCartRetentionConfig({})).toEqual({
      enabled: false,
      retentionDays: 37,
      maxDeletionsPerRun: 1_000,
    })
  })

  it("rejects a retention period shorter than the cookie grace window", () => {
    expect(() =>
      resolveCartRetentionConfig({
        ANONYMOUS_CART_RETENTION_DAYS: "30",
      })
    ).toThrow("between 37 and 365")
  })

  it("soft-deletes only anonymous incomplete carts after a locked recheck", async () => {
    const services = createServices([
      [
        cart({ id: "cart_delete" }),
        cart({ id: "cart_email", email: "protected@example.test" }),
        cart({ id: "cart_customer", customer_id: "cus_01ABC" }),
        cart({
          id: "cart_completed",
          completed_at: "2026-01-01T00:00:00.000Z",
        }),
      ],
    ])

    const result = await removeExpiredAnonymousCarts({
      ...services,
      config,
      now: new Date("2026-07-24T00:00:00.000Z"),
    })

    expect(services.lockingService.execute).toHaveBeenCalledWith(
      ["cart_delete"],
      expect.any(Function)
    )
    expect(services.cartService.deleteCarts).toHaveBeenCalledWith([
      "cart_delete",
    ])
    expect(result).toMatchObject({
      deleted: 1,
      protectedByEmail: 1,
    })
  })

  it("does not delete a cart that becomes associated before the recheck", async () => {
    const services = createServices([[cart({ id: "cart_claimed" })]])
    services.cartService.listCarts
      .mockResolvedValueOnce([cart({ id: "cart_claimed" })])
      .mockResolvedValueOnce([
        cart({ id: "cart_claimed", email: "claimed@example.test" }),
      ])
      .mockResolvedValueOnce([])

    const result = await removeExpiredAnonymousCarts({
      ...services,
      config,
      now: new Date("2026-07-24T00:00:00.000Z"),
    })

    expect(services.cartService.deleteCarts).not.toHaveBeenCalled()
    expect(result.deleted).toBe(0)
  })
})
