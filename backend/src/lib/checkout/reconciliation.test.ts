import {
  type CheckoutReconciliationConfig,
  type CheckoutReconciliationQuery,
  reconcileCheckoutPayments,
  resolveCheckoutReconciliationConfig,
} from "./reconciliation"

type RecordFixture = Record<string, unknown>

const config: CheckoutReconciliationConfig = {
  enabled: true,
  minimumAgeSeconds: 120,
  maxAttemptsPerRun: 50,
  maxRunSeconds: 90,
  maxScanPerRun: 2_000,
}

const cart = (overrides: RecordFixture = {}): RecordFixture => ({
  id: "cart_reconcile",
  completed_at: null,
  metadata: {},
  updated_at: "2026-07-25T11:00:00.000Z",
  payment_collection: {
    payment_sessions: [
      {
        id: "payses_reconcile",
        provider_id: "pp_stripe_stripe",
        status: "authorized",
      },
    ],
  },
  ...overrides,
})

const services = ({
  carts,
  orderCartIds = [],
}: {
  carts: RecordFixture[]
  orderCartIds?: string[]
}) => {
  const graph = jest.fn(
    async ({
      entity,
      filters,
      pagination,
    }: {
      entity: string
      filters?: Record<string, unknown>
      pagination?: {
        order?: Record<string, "ASC" | "DESC">
      }
    }) => {
      if (entity === "order_cart") {
        const cartId = filters?.cart_id
        return {
          data:
            typeof cartId === "string" && orderCartIds.includes(cartId)
              ? [{ order_id: "order_existing" }]
              : [],
        }
      }
      const id = filters?.id
      if (typeof id === "string") {
        return { data: carts.filter((value) => value.id === id) }
      }
      const direction = pagination?.order?.updated_at ?? "ASC"
      return {
        data: [...carts].sort((left, right) => {
          const leftKey = `${String(left.updated_at)}\u0000${String(left.id)}`
          const rightKey = `${String(right.updated_at)}\u0000${String(right.id)}`
          return direction === "ASC"
            ? leftKey.localeCompare(rightKey)
            : rightKey.localeCompare(leftKey)
        }),
      }
    }
  )
  const updateCartMetadata = jest.fn(
    async (cartId: string, metadata: Record<string, unknown>) => {
      const target = carts.find((value) => value.id === cartId)
      if (target) {
        target.metadata = metadata
      }
    }
  )
  return {
    query: { graph } as CheckoutReconciliationQuery,
    completeCart: jest.fn(async (_cartId: string) => undefined),
    updateCartMetadata,
  }
}

describe("checkout payment reconciliation", () => {
  it("defaults to a disabled and bounded policy", () => {
    expect(resolveCheckoutReconciliationConfig({})).toEqual({
      enabled: false,
      minimumAgeSeconds: 120,
      maxAttemptsPerRun: 50,
      maxRunSeconds: 90,
      maxScanPerRun: 2_000,
    })
    expect(() =>
      resolveCheckoutReconciliationConfig({
        CHECKOUT_RECONCILIATION_MIN_AGE_SECONDS: "30",
      })
    ).toThrow("between 60 and 3600")
    expect(() =>
      resolveCheckoutReconciliationConfig({
        CHECKOUT_RECONCILIATION_MAX_SCAN: "499",
      })
    ).toThrow("between 500 and 5000")
    expect(() =>
      resolveCheckoutReconciliationConfig({
        CHECKOUT_RECONCILIATION_MAX_RUN_SECONDS: "241",
      })
    ).toThrow("between 30 and 240")
  })

  it.each(["authorized", "captured"])(
    "completes an old cart with one %s Stripe session",
    async (status) => {
      const fixture = services({
        carts: [
          cart({
            payment_collection: {
              payment_sessions: [
                {
                  id: "payses_reconcile",
                  provider_id: "pp_stripe_stripe",
                  status,
                },
              ],
            },
          }),
        ],
      })

      const result = await reconcileCheckoutPayments({
        ...fixture,
        config,
        now: new Date("2026-07-25T12:00:00.000Z"),
      })

      expect(fixture.completeCart).toHaveBeenCalledWith("cart_reconcile")
      expect(result).toMatchObject({
        eligible: 1,
        attempted: 1,
        completed: 1,
        failed: 0,
      })
    }
  )

  it.each([
    [
      "pending payment",
      cart({
        payment_collection: {
          payment_sessions: [
            {
              id: "payses_pending",
              provider_id: "pp_stripe_stripe",
              status: "pending",
            },
          ],
        },
      }),
    ],
    [
      "multiple processable payments",
      cart({
        payment_collection: {
          payment_sessions: [
            {
              id: "payses_authorized",
              provider_id: "pp_stripe_stripe",
              status: "authorized",
            },
            {
              id: "payses_pending",
              provider_id: "pp_stripe_stripe",
              status: "pending",
            },
          ],
        },
      }),
    ],
    ["recent checkout", cart({ updated_at: "2026-07-25T11:59:30.000Z" })],
  ])("ignores %s", async (_label, candidate) => {
    const fixture = services({ carts: [candidate] })

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    })

    expect(fixture.completeCart).not.toHaveBeenCalled()
    expect(result.attempted).toBe(0)
  })

  it("protects a checkout already linked to an order", async () => {
    const fixture = services({
      carts: [cart()],
      orderCartIds: ["cart_reconcile"],
    })

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    })

    expect(fixture.completeCart).not.toHaveBeenCalled()
    expect(result.protectedByOrder).toBe(1)
  })

  it("persists an attempt marker before invoking cart completion", async () => {
    const fixture = services({
      carts: [cart({ metadata: { existing: "preserved" } })],
    })

    await reconcileCheckoutPayments({
      ...fixture,
      config,
      createAttemptId: () => "attempt_01",
      currentTime: () => new Date("2026-07-25T12:00:01.000Z"),
      now: new Date("2026-07-25T12:00:00.000Z"),
    })

    expect(fixture.updateCartMetadata).toHaveBeenCalledWith("cart_reconcile", {
      existing: "preserved",
      rr_checkout_reconciliation: {
        attempt_id: "attempt_01",
        started_at: "2026-07-25T12:00:01.000Z",
        state: "started",
        updated_at: "2026-07-25T12:00:01.000Z",
      },
    })
    expect(fixture.updateCartMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.completeCart.mock.invocationCallOrder[0] ?? 0
    )
  })

  it("holds a prior scheduled attempt for review instead of repeating it", async () => {
    const fixture = services({
      carts: [
        cart({
          metadata: {
            rr_checkout_reconciliation: {
              attempt_id: "attempt_stalled",
              started_at: "2026-07-25T11:55:00.000Z",
              state: "started",
              updated_at: "2026-07-25T11:55:00.000Z",
            },
          },
        }),
      ],
    })

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    })

    expect(fixture.updateCartMetadata).not.toHaveBeenCalled()
    expect(fixture.completeCart).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      attempted: 0,
      failed: 0,
      heldForReview: 1,
    })
  })

  it("does not complete after an ambiguous attempt-marker write", async () => {
    const durableCart = cart()
    const fixture = services({ carts: [durableCart] })
    fixture.updateCartMetadata.mockImplementationOnce(
      async (_cartId, metadata) => {
        durableCart.metadata = metadata
        throw new Error("response lost after durable marker write")
      }
    )

    const first = await reconcileCheckoutPayments({
      ...fixture,
      config,
      createAttemptId: () => "attempt_ambiguous",
      currentTime: () => new Date("2026-07-25T12:00:01.000Z"),
      now: new Date("2026-07-25T12:00:00.000Z"),
    })
    const second = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:02:00.000Z"),
    })

    expect(first).toMatchObject({ attempted: 0, failed: 1 })
    expect(second).toMatchObject({ attempted: 0, heldForReview: 1 })
    expect(fixture.completeCart).not.toHaveBeenCalled()
  })

  it("rechecks payment state immediately before completion", async () => {
    const fixture = services({ carts: [cart()] })
    fixture.query.graph = jest
      .fn()
      .mockResolvedValueOnce({ data: [cart()] })
      .mockResolvedValueOnce({
        data: [
          cart({
            payment_collection: {
              payment_sessions: [
                {
                  id: "payses_pending",
                  provider_id: "pp_stripe_stripe",
                  status: "pending",
                },
              ],
            },
          }),
        ],
      })

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    })

    expect(fixture.completeCart).not.toHaveBeenCalled()
    expect(result.attempted).toBe(0)
  })

  it("requires the exact durable attempt marker before completion", async () => {
    const fixture = services({ carts: [cart()] })
    fixture.updateCartMetadata.mockImplementationOnce(async () => undefined)

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      createAttemptId: () => "attempt_missing",
      currentTime: () => new Date("2026-07-25T12:00:01.000Z"),
      now: new Date("2026-07-25T12:00:00.000Z"),
    })

    expect(fixture.completeCart).not.toHaveBeenCalled()
    expect(result).toMatchObject({ attempted: 0, failed: 1 })
  })

  it("rechecks the order link after persisting the attempt marker", async () => {
    const durableCart = cart()
    const racedOrderIds: string[] = []
    const fixture = services({
      carts: [durableCart],
      orderCartIds: racedOrderIds,
    })
    fixture.updateCartMetadata.mockImplementationOnce(
      async (_cartId, metadata) => {
        durableCart.metadata = metadata
        racedOrderIds.push("cart_reconcile")
      }
    )

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    })

    expect(fixture.completeCart).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      attempted: 0,
      protectedByOrder: 1,
    })
  })

  it("records a completion failure without exposing cart details", async () => {
    const fixture = services({ carts: [cart()] })
    fixture.completeCart.mockRejectedValue(new Error("provider detail"))

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    })

    expect(result).toMatchObject({
      attempted: 1,
      completed: 0,
      failed: 1,
    })
    expect(JSON.stringify(result)).not.toContain("cart_reconcile")
    expect(JSON.stringify(result)).not.toContain("provider detail")
  })

  it("scans the configured window and reports when it is full", async () => {
    const fixture = services({
      carts: Array.from({ length: 2_000 }, (_, index) =>
        cart({
          id: `cart_pending_${index}`,
          payment_collection: {
            payment_sessions: [
              {
                id: `payses_pending_${index}`,
                provider_id: "pp_stripe_stripe",
                status: "pending",
              },
            ],
          },
        })
      ),
    })

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    })

    expect(fixture.query.graph).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        pagination: {
          order: { updated_at: "DESC", id: "DESC" },
          take: 2_000,
        },
      })
    )
    expect(result).toMatchObject({
      capped: false,
      eligible: 0,
      scanWindowFull: true,
      scanned: 2_000,
    })
  })

  it("stops starting attempts when the run-time budget is exhausted", async () => {
    const fixture = services({
      carts: [cart({ id: "cart_first" }), cart({ id: "cart_second" })],
    })
    const monotonicNow = jest
      .fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(90_000)

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      monotonicNow,
      now: new Date("2026-07-25T12:00:00.000Z"),
    })

    expect(fixture.completeCart).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      attempted: 1,
      capped: true,
      timeCapped: true,
    })
  })

  it("does not repeat completion after an ambiguous response loss", async () => {
    const durableCart = cart()
    const orderCartIds: string[] = []
    const fixture = services({ carts: [durableCart], orderCartIds })
    fixture.completeCart.mockImplementationOnce(async (cartId) => {
      durableCart.completed_at = "2026-07-25T12:00:01.000Z"
      orderCartIds.push(cartId)
      throw new Error("response lost after durable completion")
    })

    const first = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    })
    const second = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:02:00.000Z"),
    })

    expect(first).toMatchObject({ attempted: 1, failed: 1 })
    expect(second).toMatchObject({ attempted: 0, completed: 0, failed: 0 })
    expect(fixture.completeCart).toHaveBeenCalledTimes(1)
  })
})
