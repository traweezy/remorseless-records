import {
  type CheckoutReconciliationConfig,
  type CheckoutReconciliationQuery,
  reconcileCheckoutPayments,
  resolveCheckoutReconciliationConfig,
} from "./reconciliation";

type RecordFixture = Record<string, unknown>;

const config: CheckoutReconciliationConfig = {
  enabled: true,
  minimumAgeSeconds: 120,
  maxAttemptsPerRun: 50,
};

const cart = (overrides: RecordFixture = {}): RecordFixture => ({
  id: "cart_reconcile",
  completed_at: null,
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
});

const services = ({
  carts,
  orderCartIds = [],
}: {
  carts: RecordFixture[];
  orderCartIds?: string[];
}) => {
  const graph = jest.fn(
    async ({
      entity,
      filters,
    }: {
      entity: string;
      filters?: Record<string, unknown>;
    }) => {
      if (entity === "order_cart") {
        const cartId = filters?.cart_id;
        return {
          data:
            typeof cartId === "string" && orderCartIds.includes(cartId)
              ? [{ order_id: "order_existing" }]
              : [],
        };
      }
      const id = filters?.id;
      return {
        data:
          typeof id === "string"
            ? carts.filter((value) => value.id === id)
            : carts,
      };
    },
  );
  return {
    query: { graph } as CheckoutReconciliationQuery,
    completeCart: jest.fn(async () => undefined),
  };
};

describe("checkout payment reconciliation", () => {
  it("defaults to a disabled and bounded policy", () => {
    expect(resolveCheckoutReconciliationConfig({})).toEqual({
      enabled: false,
      minimumAgeSeconds: 120,
      maxAttemptsPerRun: 50,
    });
    expect(() =>
      resolveCheckoutReconciliationConfig({
        CHECKOUT_RECONCILIATION_MIN_AGE_SECONDS: "30",
      }),
    ).toThrow("between 60 and 3600");
  });

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
      });

      const result = await reconcileCheckoutPayments({
        ...fixture,
        config,
        now: new Date("2026-07-25T12:00:00.000Z"),
      });

      expect(fixture.completeCart).toHaveBeenCalledWith("cart_reconcile");
      expect(result).toMatchObject({
        eligible: 1,
        attempted: 1,
        completed: 1,
        failed: 0,
      });
    },
  );

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
    const fixture = services({ carts: [candidate] });

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(fixture.completeCart).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
  });

  it("protects a checkout already linked to an order", async () => {
    const fixture = services({
      carts: [cart()],
      orderCartIds: ["cart_reconcile"],
    });

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(fixture.completeCart).not.toHaveBeenCalled();
    expect(result.protectedByOrder).toBe(1);
  });

  it("rechecks payment state immediately before completion", async () => {
    const fixture = services({ carts: [cart()] });
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
      });

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(fixture.completeCart).not.toHaveBeenCalled();
    expect(result.attempted).toBe(0);
  });

  it("records a completion failure without exposing cart details", async () => {
    const fixture = services({ carts: [cart()] });
    fixture.completeCart.mockRejectedValue(new Error("provider detail"));

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      attempted: 1,
      completed: 0,
      failed: 1,
    });
    expect(JSON.stringify(result)).not.toContain("cart_reconcile");
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });

  it("scans the most recently aged carts without alerting on irrelevant volume", async () => {
    const fixture = services({
      carts: Array.from({ length: 500 }, (_, index) =>
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
        }),
      ),
    });

    const result = await reconcileCheckoutPayments({
      ...fixture,
      config,
      now: new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(fixture.query.graph).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        pagination: {
          order: { updated_at: "DESC" },
          take: 500,
        },
      }),
    );
    expect(result).toMatchObject({
      capped: false,
      eligible: 0,
      scanWindowFull: true,
      scanned: 500,
    });
  });
});
