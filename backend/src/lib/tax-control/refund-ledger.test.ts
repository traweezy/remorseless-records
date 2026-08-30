import { buildRefundLedgerMismatches } from "./refund-ledger"

const evidence = (refundAmountMinor: number) => ({
  association_status: "committed",
  cart_id: "cart_01",
  collection_mode: "collect" as const,
  currency_code: "usd",
  id: "taxevidence_01",
  last_verified_at: "2026-07-26T00:00:00.000Z",
  metadata: { refund_amount_minor: refundAmountMinor },
  order_id: "order_01",
  payment_intent_id: "pi_test",
  provider: "stripe_tax" as const,
  status: "partially_refunded" as const,
})

const order = (refundAmounts: unknown[]) => ({
  id: "order_01",
  payment_collections: [
    {
      payments: [
        {
          data: { id: "pi_test" },
          provider_id: "pp_stripe_stripe",
          refunds: refundAmounts.map((amount) => ({ amount })),
        },
      ],
    },
  ],
})

describe("Stripe and Medusa refund ledger comparison", () => {
  it("accepts matching partial refunds across both systems", () => {
    expect(
      buildRefundLedgerMismatches({
        evidence: [evidence(725)],
        paymentRecords: [order([5, "2.25"])],
      })
    ).toEqual([])
  })

  it("surfaces a refund created outside Medusa", () => {
    expect(
      buildRefundLedgerMismatches({
        evidence: [evidence(725)],
        paymentRecords: [order([])],
      })
    ).toEqual([
      {
        evidence: evidence(725),
        medusaRefundAmountMinor: 0,
        stripeEvidenceAvailable: true,
        stripeRefundAmountMinor: 725,
      },
    ])
  })

  it("surfaces a Medusa refund not yet reflected by Stripe", () => {
    expect(
      buildRefundLedgerMismatches({
        evidence: [evidence(500)],
        paymentRecords: [order([7.25])],
      })
    ).toEqual([
      {
        evidence: evidence(500),
        medusaRefundAmountMinor: 725,
        stripeEvidenceAvailable: true,
        stripeRefundAmountMinor: 500,
      },
    ])
  })

  it("surfaces a Medusa refund before Stripe evidence has been recorded", () => {
    expect(
      buildRefundLedgerMismatches({
        evidence: [{ ...evidence(0), metadata: {} }],
        paymentRecords: [order([7.25])],
      })
    ).toEqual([
      {
        evidence: { ...evidence(0), metadata: {} },
        medusaRefundAmountMinor: 725,
        stripeEvidenceAvailable: false,
        stripeRefundAmountMinor: 0,
      },
    ])
  })

  it("matches a pre-order compensation refund on the cart", () => {
    const cart = {
      id: "cart_01",
      payment_collection: order([7.25]).payment_collections[0],
    }

    expect(
      buildRefundLedgerMismatches({
        evidence: [{ ...evidence(725), order_id: null }],
        paymentRecords: [cart],
      })
    ).toEqual([])
  })

  it("ignores untrusted providers and unrelated valid intents", () => {
    expect(
      buildRefundLedgerMismatches({
        evidence: [evidence(500)],
        paymentRecords: [
          {
            payment_collections: [
              {
                payments: [
                  {
                    data: { id: "pi_test" },
                    provider_id: "pp_other",
                    refunds: [{ amount: 5 }],
                  },
                  {
                    data: { id: "pi_other" },
                    provider_id: "pp_stripe_stripe",
                    refunds: [{ amount: 5 }],
                  },
                ],
              },
            ],
          },
        ],
      })
    ).toEqual([
      {
        evidence: evidence(500),
        medusaRefundAmountMinor: 0,
        stripeEvidenceAvailable: true,
        stripeRefundAmountMinor: 500,
      },
    ])
  })

  it.each([
    [
      "primitive payment row",
      [{ payment_collections: [{ payments: [false] }] }],
    ],
    [
      "invalid Stripe intent",
      [
        {
          payment_collections: [
            {
              payments: [
                {
                  data: { id: "not-an-intent" },
                  provider_id: "pp_stripe_stripe",
                  refunds: [],
                },
              ],
            },
          ],
        },
      ],
    ],
    ["malformed refund amount", [order(["invalid"])]],
  ])("fails closed on a %s", (_label, paymentRecords) => {
    expect(() =>
      buildRefundLedgerMismatches({
        evidence: [evidence(500)],
        paymentRecords,
      })
    ).toThrow()
  })

  it("rejects coercive Stripe evidence amounts", () => {
    expect(() =>
      buildRefundLedgerMismatches({
        evidence: [
          {
            ...evidence(0),
            metadata: { refund_amount_minor: true },
          },
        ],
        paymentRecords: [order([])],
      })
    ).toThrow("Refund evidence amount is malformed")
  })
})
