import { projectRefundCases, summarizeRefundCases } from "./projection"

type EvidenceOverrides = {
  associationStatus?: string
  collectionMode?: "collect" | "disabled"
  metadata?: Record<string, unknown>
  provider?: "stripe_tax" | "taxrate_io" | null
  status?: string
}

const evidenceFixture = ({
  associationStatus = "committed",
  collectionMode = "collect",
  metadata = {
    refund_amount_minor: 500,
    refund_tax_missing_sources: [],
    refund_tax_transaction_ids: ["tax_txn_refund"],
    stripe_refund_count: 1,
    stripe_refund_statuses: [{ status: "succeeded" }],
  },
  provider = "stripe_tax",
  status = "partially_refunded",
}: EvidenceOverrides = {}) => ({
  amount_minor: 2_000,
  association_status: associationStatus,
  cart_id: "cart_01",
  collection_mode: collectionMode,
  currency_code: "usd",
  id: "taxevidence_01",
  last_verified_at: "2026-07-26T15:00:00.000Z",
  metadata,
  order_id: "order_01",
  payment_intent_id: "pi_test",
  provider,
  status,
})

const orderFixture = ({
  refunds = [{ amount: 5, created_at: "2026-07-26T14:00:00.000Z" }],
}: {
  refunds?: unknown[]
} = {}) => ({
  currency_code: "usd",
  display_id: 42,
  id: "order_01",
  payment_collections: [
    {
      payments: [
        {
          amount: 20,
          captured_amount: 20,
          currency_code: "usd",
          data: { id: "pi_test" },
          id: "pay_01",
          provider_id: "pp_stripe_stripe",
          refunds,
        },
      ],
    },
  ],
})

describe("refund operations projection", () => {
  it("omits payments without refund or dispute signals", () => {
    expect(
      projectRefundCases({
        evidence: [
          evidenceFixture({
            metadata: {},
            status: "succeeded",
          }),
        ],
        orders: [orderFixture({ refunds: [] })],
      })
    ).toEqual([])
  })

  it("marks a reconciled Stripe Tax refund as verified", () => {
    expect(
      projectRefundCases({
        evidence: [evidenceFixture()],
        orders: [orderFixture()],
      })
    ).toEqual([
      expect.objectContaining({
        medusaRefundAmountMinor: 500,
        status: "verified",
        stripeRefundAmountMinor: 500,
        taxStatus: "verified",
      }),
    ])
  })

  it("does not require a Stripe Tax reversal for TaxRate.io", () => {
    const refundCase = projectRefundCases({
      evidence: [
        evidenceFixture({
          metadata: {
            refund_amount_minor: 500,
            stripe_refund_count: 1,
            stripe_refund_statuses: [{ status: "succeeded" }],
          },
          provider: "taxrate_io",
        }),
      ],
      orders: [orderFixture()],
    })[0]

    expect(refundCase).toMatchObject({
      provider: "taxrate_io",
      status: "verified",
      taxStatus: "not_applicable",
    })
  })

  it("verifies a matched refund when tax collection was disabled", () => {
    const refundCase = projectRefundCases({
      evidence: [
        evidenceFixture({
          associationStatus: "not_applicable",
          collectionMode: "disabled",
          metadata: {
            collection_mode: "disabled",
            refund_amount_minor: 500,
            stripe_refund_count: 1,
            stripe_refund_statuses: [{ status: "succeeded" }],
          },
          provider: null,
        }),
      ],
      orders: [orderFixture()],
    })[0]

    expect(refundCase).toMatchObject({
      provider: "disabled",
      status: "verified",
      taxStatus: "not_collected",
    })
    expect(refundCase?.nextAction).toContain(
      "Medusa, Stripe, and the applicable tax evidence agree"
    )
  })

  it("verifies full and repeated partial refunds from exact ledgers", () => {
    const full = projectRefundCases({
      evidence: [
        evidenceFixture({
          metadata: {
            refund_amount_minor: 2_000,
            refund_tax_missing_sources: [],
            refund_tax_transaction_ids: ["tax_txn_full"],
            stripe_refund_count: 1,
            stripe_refund_statuses: [{ status: "succeeded" }],
          },
          status: "refunded",
        }),
      ],
      orders: [orderFixture({ refunds: [{ amount: 20 }] })],
    })[0]
    const repeatedPartial = projectRefundCases({
      evidence: [
        evidenceFixture({
          metadata: {
            refund_amount_minor: 500,
            refund_tax_missing_sources: [],
            refund_tax_transaction_ids: ["tax_txn_first", "tax_txn_second"],
            stripe_refund_count: 2,
            stripe_refund_statuses: [
              { status: "succeeded" },
              { status: "succeeded" },
            ],
          },
        }),
      ],
      orders: [orderFixture({ refunds: [{ amount: 2 }, { amount: 3 }] })],
    })[0]

    expect(full).toMatchObject({
      medusaRefundAmountMinor: 2_000,
      medusaRefundCount: 1,
      status: "verified",
      stripeRefundAmountMinor: 2_000,
      stripeRefundCount: 1,
      taxStatus: "verified",
    })
    expect(repeatedPartial).toMatchObject({
      medusaRefundAmountMinor: 500,
      medusaRefundCount: 2,
      status: "verified",
      stripeRefundAmountMinor: 500,
      stripeRefundCount: 2,
      taxStatus: "verified",
    })
  })

  it.each(["pending", "requires_action"] as const)(
    "keeps a %s provider refund in processing without suggesting a retry",
    (stripeStatus) => {
      const refundCase = projectRefundCases({
        evidence: [
          evidenceFixture({
            associationStatus: "not_applicable",
            metadata: {
              refund_amount_minor: 500,
              stripe_refund_count: 1,
              stripe_refund_statuses: [{ status: stripeStatus }],
            },
            provider: "taxrate_io",
          }),
        ],
        orders: [orderFixture()],
      })[0]

      expect(refundCase).toMatchObject({
        status: "processing",
        stripeStatuses: [stripeStatus],
        taxStatus: "not_applicable",
      })
      expect(refundCase?.nextAction).toContain(
        "Wait for Stripe and the automatic verification job"
      )
    }
  )

  it("keeps a missing Stripe Tax reversal in processing", () => {
    const refundCase = projectRefundCases({
      evidence: [
        evidenceFixture({
          associationStatus: "refund_pending",
          metadata: {
            refund_amount_minor: 500,
            refund_tax_missing_sources: ["re_test"],
            refund_tax_transaction_ids: [],
            stripe_refund_count: 1,
            stripe_refund_statuses: [{ status: "succeeded" }],
          },
        }),
      ],
      orders: [orderFixture()],
    })[0]

    expect(refundCase).toMatchObject({
      status: "processing",
      taxStatus: "pending",
    })
    expect(refundCase?.nextAction).toContain("automatic verification job")
  })

  it.each(["failed", "canceled"] as const)(
    "requires action for a %s provider refund",
    (stripeStatus) => {
      const refundCase = projectRefundCases({
        evidence: [
          evidenceFixture({
            associationStatus: `refund_failed:${stripeStatus}`,
            metadata: {
              refund_amount_minor: 0,
              stripe_refund_count: 1,
              stripe_refund_statuses: [{ status: stripeStatus }],
            },
            status: "association_failed",
          }),
        ],
        orders: [orderFixture()],
      })[0]

      expect(refundCase).toMatchObject({
        status: "action_required",
        taxStatus: "attention",
      })
      expect(refundCase?.nextAction).toContain("without retrying blindly")
    }
  )

  it("guards against a refund made directly in Stripe", () => {
    const refundCase = projectRefundCases({
      evidence: [
        evidenceFixture({
          metadata: {
            refund_amount_minor: 500,
            stripe_refund_count: 1,
            stripe_refund_statuses: [{ status: "succeeded" }],
          },
          provider: "taxrate_io",
        }),
      ],
      orders: [orderFixture({ refunds: [] })],
    })[0]

    expect(refundCase).toMatchObject({
      medusaRefundAmountMinor: 0,
      status: "action_required",
      stripeRefundAmountMinor: 500,
    })
    expect(refundCase?.nextAction).toContain("Do not refund again")
  })

  it("does not suggest a retry while Medusa is ahead of Stripe", () => {
    const refundCase = projectRefundCases({
      evidence: [
        evidenceFixture({
          metadata: {
            refund_amount_minor: 200,
            stripe_refund_count: 1,
            stripe_refund_statuses: [{ status: "pending" }],
          },
          provider: "taxrate_io",
        }),
      ],
      orders: [orderFixture()],
    })[0]

    expect(refundCase?.status).toBe("action_required")
    expect(refundCase?.nextAction).toContain("Do not retry yet")
  })

  it("makes a dispute the highest-priority action", () => {
    const refundCase = projectRefundCases({
      evidence: [
        evidenceFixture({
          metadata: {
            disputed: true,
            refund_amount_minor: 500,
            stripe_refund_count: 1,
            stripe_refund_statuses: [{ status: "succeeded" }],
          },
          provider: "taxrate_io",
          status: "disputed",
        }),
      ],
      orders: [orderFixture()],
    })[0]

    expect(refundCase?.status).toBe("action_required")
    expect(refundCase?.nextAction).toContain("Pause additional refunds")
  })

  it("tracks a Medusa refund while provider evidence is unavailable", () => {
    const refundCase = projectRefundCases({
      evidence: [],
      orders: [orderFixture()],
    })[0]

    expect(refundCase).toMatchObject({
      provider: "untracked",
      status: "processing",
      stripeRefundAmountMinor: null,
      taxStatus: "untracked",
    })
  })

  it("fails closed on malformed evidence and relationship records", () => {
    expect(() => projectRefundCases({ evidence: [false], orders: [] })).toThrow(
      "Refund operations evidence query returned malformed structured data."
    )
    expect(() =>
      projectRefundCases({
        evidence: [],
        orders: [orderFixture({ refunds: [false] })],
      })
    ).toThrow(
      "Refund operations projection relationship returned malformed structured data."
    )
  })

  it("fails closed instead of coercing an invalid refund amount", () => {
    expect(() =>
      projectRefundCases({
        evidence: [],
        orders: [orderFixture({ refunds: [{ amount: true }] })],
      })
    ).toThrow("Refund operations projection encountered invalid monetary data.")
  })

  it("does not call a legacy refund verified without individual statuses", () => {
    const refundCase = projectRefundCases({
      evidence: [
        evidenceFixture({
          metadata: {
            refund_amount_minor: 500,
            stripe_refund_count: 1,
          },
          provider: "taxrate_io",
        }),
      ],
      orders: [orderFixture()],
    })[0]

    expect(refundCase).toMatchObject({
      status: "processing",
      stripeStatuses: [],
    })
  })

  it("surfaces checkout compensation refunds that have no order", () => {
    const refundCase = projectRefundCases({
      evidence: [
        {
          ...evidenceFixture({
            metadata: {
              refund_amount_minor: 2_000,
              stripe_refund_count: 1,
              stripe_refund_statuses: [{ status: "succeeded" }],
            },
            provider: "taxrate_io",
            status: "refunded",
          }),
          order_id: null,
        },
      ],
      orders: [],
    })[0]

    expect(refundCase).toMatchObject({
      displayId: null,
      medusaRefundAmountMinor: 0,
      orderId: null,
      status: "action_required",
    })
  })

  it("summarizes case states and Medusa-recorded amounts by currency", () => {
    const verified = projectRefundCases({
      evidence: [evidenceFixture()],
      orders: [orderFixture()],
    })[0]
    const processing = projectRefundCases({
      evidence: [],
      orders: [
        {
          ...orderFixture(),
          currency_code: "cad",
          id: "order_02",
          payment_collections: [
            {
              payments: [
                {
                  amount: 10,
                  captured_amount: 10,
                  currency_code: "cad",
                  data: { id: "pi_second" },
                  id: "pay_02",
                  provider_id: "pp_stripe_stripe",
                  refunds: [{ amount: 2 }],
                },
              ],
            },
          ],
        },
      ],
    })[0]

    expect(summarizeRefundCases([verified!, processing!])).toEqual({
      actionRequired: 0,
      amountsByCurrency: [
        { amountMinor: 200, currencyCode: "cad" },
        { amountMinor: 500, currencyCode: "usd" },
      ],
      processing: 1,
      totalCases: 2,
      verified: 1,
    })
  })
})
