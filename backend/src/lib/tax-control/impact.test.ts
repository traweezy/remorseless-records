import {
  loadTaxControlImpact,
  summarizeTaxControlImpact,
  type TaxControlImpactQuery,
} from "./impact"

const cart = ({
  collectionMode = "collect",
  provider = "taxrate_io",
  sessionProvider = "pp_stripe_stripe",
  status = "pending",
}: {
  collectionMode?: "collect" | "disabled"
  provider?: string
  sessionProvider?: string
  status?: string
} = {}) => ({
  id: crypto.randomUUID(),
  payment_collection: {
    payment_sessions: [
      {
        data: {
          metadata: {
            rr_tax_collection_mode: collectionMode,
            ...(collectionMode === "collect"
              ? { rr_tax_provider: provider }
              : {}),
          },
        },
        provider_id: sessionProvider,
        status,
      },
    ],
  },
})

describe("tax-control checkout impact", () => {
  it("counts only processable Stripe checkout sessions", () => {
    expect(
      summarizeTaxControlImpact([
        cart(),
        cart({ provider: "stripe_tax", status: "requires_more" }),
        cart({ provider: "stripe_tax", status: "authorized" }),
        cart({ collectionMode: "disabled" }),
        cart({ status: "error" }),
        cart({ sessionProvider: "pp_system" }),
      ])
    ).toEqual({
      activityWindowDays: 30,
      frozenByCollectionMode: {
        collect: 3,
        disabled: 1,
      },
      frozenByProvider: {
        stripe_tax: 2,
        taxrate_io: 1,
      },
      paymentsFinalizing: 1,
      preparedCheckouts: 4,
    })
  })

  it("counts a cart once when it has multiple processable sessions", () => {
    const duplicateSessionCart = cart()
    duplicateSessionCart.payment_collection.payment_sessions.push({
      data: {
        metadata: {
          rr_tax_collection_mode: "collect",
          rr_tax_provider: "taxrate_io",
        },
      },
      provider_id: "pp_stripe_stripe",
      status: "pending_authorization",
    })

    expect(summarizeTaxControlImpact([duplicateSessionCart])).toMatchObject({
      paymentsFinalizing: 1,
      preparedCheckouts: 1,
    })
  })

  it("ignores stale tax identity on a non-processable session", () => {
    const activeCart = cart()
    activeCart.payment_collection.payment_sessions.push({
      data: {
        metadata: {
          rr_tax_collection_mode: "collect",
          rr_tax_provider: "stripe_tax",
        },
      },
      provider_id: "pp_stripe_stripe",
      status: "error",
    })

    expect(summarizeTaxControlImpact([activeCart])).toMatchObject({
      frozenByProvider: {
        stripe_tax: 0,
        taxrate_io: 1,
      },
      preparedCheckouts: 1,
    })
  })

  it("paginates the full activity window instead of returning a sample", async () => {
    const firstPage = Array.from({ length: 250 }, () => cart())
    const secondPage = [cart({ provider: "stripe_tax" })]
    const query: TaxControlImpactQuery = {
      graph: jest
        .fn()
        .mockResolvedValueOnce({
          data: firstPage,
          metadata: { count: 251, skip: 0, take: 250 },
        })
        .mockResolvedValueOnce({
          data: secondPage,
          metadata: { count: 251, skip: 250, take: 250 },
        }),
    }

    const impact = await loadTaxControlImpact(
      query,
      new Date("2026-07-26T12:00:00.000Z")
    )

    expect(impact.preparedCheckouts).toBe(251)
    expect(query.graph).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        pagination: expect.objectContaining({ skip: 250, take: 250 }),
      })
    )
    expect(query.graph).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filters: {
          completed_at: null,
          updated_at: { $gte: "2026-06-26T12:00:00.000Z" },
        },
      })
    )
  })

  it("rejects malformed graph rows instead of undercounting", async () => {
    const query: TaxControlImpactQuery = {
      graph: jest.fn(async () => ({
        data: [false],
        metadata: { count: 1, skip: 0, take: 250 },
      })),
    }

    await expect(loadTaxControlImpact(query)).rejects.toThrow(
      "Tax-control impact query returned malformed structured data"
    )
  })

  it("rejects a short page before its declared total", async () => {
    const query: TaxControlImpactQuery = {
      graph: jest.fn(async () => ({
        data: [cart()],
        metadata: { count: 2, skip: 0, take: 250 },
      })),
    }

    await expect(loadTaxControlImpact(query)).rejects.toThrow(
      "Tax-control impact query returned a truncated page"
    )
  })

  it("rejects present but malformed pagination metadata", async () => {
    const query: TaxControlImpactQuery = {
      graph: jest.fn(async () => ({
        data: [cart()],
        metadata: { count: 1, skip: false, take: 250 },
      })),
    }

    await expect(loadTaxControlImpact(query)).rejects.toThrow(
      "Tax-control impact pagination metadata is malformed"
    )
  })

  it("rejects malformed and conflicting processable sessions", () => {
    const malformed = cart()
    malformed.payment_collection.payment_sessions.push(false as never)
    expect(() => summarizeTaxControlImpact([malformed])).toThrow(
      "payment-session query returned malformed structured data"
    )

    const conflicting = cart()
    conflicting.payment_collection.payment_sessions.push(
      cart({ collectionMode: "disabled" }).payment_collection
        .payment_sessions[0]!
    )
    expect(() => summarizeTaxControlImpact([conflicting])).toThrow(
      "tax identity is inconsistent"
    )
  })
})
