import {
  readCheckoutAnonymousRetentionPage,
  readCheckoutAnonymousRetentionSelection,
  readCheckoutOrderLink,
  readCheckoutReconciliationCart,
  readCheckoutReconciliationPage,
  readCheckoutRetentionCart,
  readCheckoutRetentionPage,
  readCheckoutStatusCart,
} from "./persistence-contracts"

const INVALID_PERSISTENCE =
  "The checkout persistence boundary returned invalid structured data."

const reconciliationCart = (overrides: Record<string, unknown> = {}) => ({
  id: "cart_reconcile",
  completed_at: null,
  metadata: {},
  updated_at: "2026-08-30T12:00:00.000Z",
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

const retentionCart = (overrides: Record<string, unknown> = {}) => ({
  id: "cart_retention",
  completed_at: null,
  customer_id: null,
  email: "buyer@example.test",
  updated_at: "2026-01-01T00:00:00.000Z",
  payment_collection: null,
  ...overrides,
})

describe("checkout persistence contracts", () => {
  it("maps complete reconciliation, retention, and status rows", () => {
    expect(
      readCheckoutReconciliationPage({ data: [reconciliationCart()] }, 2_000)
    ).toEqual([
      {
        completedAt: null,
        id: "cart_reconcile",
        metadata: {},
        paymentSessions: [
          {
            id: "payses_reconcile",
            providerId: "pp_stripe_stripe",
            status: "authorized",
          },
        ],
        updatedAt: "2026-08-30T12:00:00.000Z",
      },
    ])
    expect(readCheckoutRetentionPage({ data: [retentionCart()] }, 100)).toEqual(
      [
        {
          completedAt: null,
          customerId: null,
          email: "buyer@example.test",
          id: "cart_retention",
          paymentCollection: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ]
    )
    expect(
      readCheckoutAnonymousRetentionPage(
        [
          {
            id: "cart_anonymous",
            completed_at: null,
            customer_id: null,
            email: null,
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        250
      )
    ).toEqual([
      {
        completedAt: null,
        customerId: null,
        email: null,
        id: "cart_anonymous",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ])
    expect(
      readCheckoutStatusCart(
        {
          data: [
            {
              id: "cart_status",
              completed_at: null,
              payment_collection: null,
            },
          ],
        },
        "cart_status"
      )
    ).toEqual({
      completedAt: null,
      id: "cart_status",
      paymentSessions: [],
    })
  })

  it.each([undefined, null, []])(
    "normalizes an absent payment-collection relation (%p)",
    (paymentCollection) => {
      expect(
        readCheckoutReconciliationPage(
          {
            data: [
              reconciliationCart({ payment_collection: paymentCollection }),
            ],
          },
          1
        )
      ).toMatchObject([{ paymentSessions: [] }])
      expect(
        readCheckoutRetentionCart(
          {
            data: [retentionCart({ payment_collection: paymentCollection })],
          },
          "cart_retention"
        )
      ).toMatchObject({ paymentCollection: null })
    }
  )

  it("normalizes a singleton relationship array and rejects ambiguity", () => {
    const collection = reconciliationCart().payment_collection
    expect(
      readCheckoutReconciliationPage(
        {
          data: [reconciliationCart({ payment_collection: [collection] })],
        },
        1
      )
    ).toMatchObject([
      {
        paymentSessions: [
          {
            id: "payses_reconcile",
            providerId: "pp_stripe_stripe",
            status: "authorized",
          },
        ],
      },
    ])
    expect(() =>
      readCheckoutReconciliationPage(
        {
          data: [
            reconciliationCart({
              payment_collection: [collection, collection],
            }),
          ],
        },
        1
      )
    ).toThrow(INVALID_PERSISTENCE)
  })

  it.each([
    null,
    {},
    { data: null },
    { data: [reconciliationCart(), reconciliationCart()] },
  ])("rejects malformed or oversized reconciliation envelopes", (value) => {
    expect(() => readCheckoutReconciliationPage(value, 1)).toThrow(
      INVALID_PERSISTENCE
    )
  })

  it("rejects duplicate and nondeterministically ordered page identities", () => {
    expect(() =>
      readCheckoutReconciliationPage(
        {
          data: [
            reconciliationCart(),
            reconciliationCart({
              id: "cart_newer",
              updated_at: "2026-08-30T13:00:00.000Z",
            }),
          ],
        },
        2
      )
    ).toThrow(INVALID_PERSISTENCE)
    expect(() =>
      readCheckoutRetentionPage(
        {
          data: [
            retentionCart({ id: "cart_z" }),
            retentionCart({ id: "cart_a" }),
          ],
        },
        2
      )
    ).toThrow(INVALID_PERSISTENCE)
  })

  it.each([
    reconciliationCart({ id: "wrong_reconcile" }),
    reconciliationCart({ completed_at: "not-a-time" }),
    reconciliationCart({ updated_at: undefined }),
    reconciliationCart({ metadata: { unsafe: Number.NaN } }),
    reconciliationCart({ metadata: { unsafe: new Date() } }),
    reconciliationCart({ metadata: { constructor: "unsafe" } }),
    reconciliationCart({ payment_collection: {} }),
    reconciliationCart({
      payment_collection: {
        payment_sessions: [
          {
            id: "payses_reconcile",
            provider_id: "stripe",
            status: "authorized",
          },
        ],
      },
    }),
    reconciliationCart({
      payment_collection: {
        payment_sessions: [
          {
            id: "payses_reconcile",
            provider_id: "pp_stripe_stripe",
            status: "future_status",
          },
        ],
      },
    }),
  ])("rejects malformed reconciliation cart state", (value) => {
    expect(() =>
      readCheckoutReconciliationCart({ data: [value] }, "cart_reconcile")
    ).toThrow(INVALID_PERSISTENCE)
  })

  it("rejects ambiguous singleton cart responses", () => {
    expect(() =>
      readCheckoutReconciliationCart(
        { data: [reconciliationCart(), reconciliationCart()] },
        "cart_reconcile"
      )
    ).toThrow(INVALID_PERSISTENCE)
    expect(() =>
      readCheckoutRetentionCart(
        { data: [retentionCart(), retentionCart()] },
        "cart_retention"
      )
    ).toThrow(INVALID_PERSISTENCE)
  })

  it("rejects unexpected or duplicate anonymous-cart selections", () => {
    expect(() =>
      readCheckoutAnonymousRetentionSelection(
        [
          {
            id: "cart_unexpected",
            completed_at: null,
            customer_id: null,
            email: null,
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        ["cart_expected"]
      )
    ).toThrow(INVALID_PERSISTENCE)
    expect(() =>
      readCheckoutAnonymousRetentionSelection(
        [],
        ["cart_expected", "cart_expected"]
      )
    ).toThrow(INVALID_PERSISTENCE)
  })

  it.each([
    retentionCart({ id: "wrong_retention" }),
    retentionCart({ customer_id: "customer_unsafe" }),
    retentionCart({ email: "" }),
    retentionCart({ updated_at: "not-a-time" }),
    retentionCart({ payment_collection: {} }),
    retentionCart({
      payment_collection: {
        id: "paycol_invalid value",
        status: "awaiting",
        payment_sessions: [],
      },
    }),
    retentionCart({
      payment_collection: {
        id: "paycol_retention",
        status: "awaiting now",
        payment_sessions: [],
      },
    }),
    retentionCart({
      payment_collection: {
        id: "paycol_retention",
        status: "awaiting",
        payment_sessions: [
          {
            id: "payses_retention",
            provider_id: "pp_stripe stripe",
            status: "pending",
          },
        ],
      },
    }),
  ])("rejects malformed retention cart state", (value) => {
    expect(() =>
      readCheckoutRetentionCart({ data: [value] }, "cart_retention")
    ).toThrow(INVALID_PERSISTENCE)
  })

  it("allows an unknown but canonical retention payment status to fail safe", () => {
    expect(
      readCheckoutRetentionCart(
        {
          data: [
            retentionCart({
              payment_collection: {
                id: "paycol_retention",
                status: "future_collection_state",
                payment_sessions: [
                  {
                    id: "payses_retention",
                    provider_id: "pp_future_provider",
                    status: "future_session_state",
                  },
                ],
              },
            }),
          ],
        },
        "cart_retention"
      )
    ).toMatchObject({
      paymentCollection: {
        status: "future_collection_state",
        sessions: [{ status: "future_session_state" }],
      },
    })
  })

  it.each([
    { data: [{ order_id: "order_valid" }, { order_id: "order_other" }] },
    { data: [{ order_id: "invalid_order" }] },
    { data: [{ order_id: 42 }] },
  ])("rejects ambiguous or malformed order links", (value) => {
    expect(() => readCheckoutOrderLink(value)).toThrow(INVALID_PERSISTENCE)
  })

  it("maps empty and exact order-link responses", () => {
    expect(readCheckoutOrderLink({ data: [] })).toBeNull()
    expect(readCheckoutOrderLink({ data: [{ order_id: "order_valid" }] })).toBe(
      "order_valid"
    )
  })
})
