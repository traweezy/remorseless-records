import { BigNumber } from "@medusajs/framework/utils"

import { parseTaxReportPeriod } from "./periods"
import {
  diagnoseTaxProjection,
  projectTaxRecords,
  summarizeDestinations,
  summarizeTaxRecords,
} from "./projection"

const fingerprint = "a".repeat(43)
const period = parseTaxReportPeriod({
  endDate: "2027-03-01",
  startDate: "2026-03-01",
})

const orderFixture = ({
  controlled = true,
  createdAt = "2026-07-20T16:00:00.000Z",
  paid = true,
  refund,
}: {
  controlled?: boolean
  createdAt?: string
  paid?: boolean
  refund?:
    | { amount: string; createdAt: string }
    | { amount: string; createdAt: string }[]
} = {}) => ({
  created_at: createdAt,
  currency_code: "usd",
  display_id: 42,
  id: "order_42",
  items: [
    {
      id: "item_42",
      original_subtotal: "10",
      original_tax_total: "0.8",
      tax_lines: [
        controlled
          ? {
              code: "rr_tax:taxrate_io:g2:quote",
              data: {
                fingerprint,
                generation: 2,
                jurisdiction: {
                  city: "Buffalo",
                  country_code: "US",
                  county: "Erie",
                  level: "county",
                  name: "Erie County",
                  state: "NY",
                },
                provider: "taxrate_io",
              },
              provider_id: "rate_lookup",
              rate: "8",
            }
          : {
              code: "sales_tax",
              data: null,
              provider_id: "rate_lookup",
              rate: "8",
            },
      ],
    },
  ],
  original_subtotal: "10",
  original_tax_total: "0.8",
  original_total: "10.8",
  payment_collections: [
    {
      payments: [
        {
          captured_amount: paid ? "10.8" : "0",
          captured_at: paid ? createdAt : null,
          refunds: (refund
            ? Array.isArray(refund)
              ? refund
              : [refund]
            : []
          ).map((entry, index) => ({
            amount: entry.amount,
            created_at: entry.createdAt,
            id: `refund_42_${index}`,
          })),
        },
      ],
    },
  ],
  shipping_address: {
    city: "Buffalo",
    country_code: "us",
    postal_code: "14201",
    province: "NY",
  },
  summary: { paid_total: paid ? "10.8" : "0" },
})

describe("tax record projection", () => {
  it("reports privacy-safe reasons when an order is not projected", () => {
    const order = orderFixture()
    const diagnostics = diagnoseTaxProjection({
      orders: [
        {
          ...order,
          display_id: new BigNumber("42"),
          payment_collections: [],
          summary: undefined,
        },
      ],
      period,
    })

    expect(diagnostics).toMatchObject({
      ordersInPeriod: 1,
      ordersWithCaptureTimestamp: 0,
      ordersWithIntegerDisplayId: 1,
      ordersWithOccurredAt: 1,
      ordersWithOrderId: 1,
      ordersWithPositiveCaptureTotal: 0,
      ordersWithPositiveCapturedPaymentTotal: 0,
      ordersWithPositiveCollectionCapturedTotal: 0,
      ordersWithPositiveOriginalTotal: 1,
      ordersWithPositivePaidTotal: 0,
      ordersWithPositiveSummaryPaidTotal: 0,
      projectedSales: 0,
      structuredOrders: 1,
    })
  })

  it("projects a complete controlled sale", () => {
    const records = projectTaxRecords({
      orders: [orderFixture()],
      period,
    })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      generation: 2,
      grossSales: "10.0000",
      provider: "taxrate_io",
      quality: "complete",
      taxAmount: "0.8000",
      taxableSales: "10.0000",
      total: "10.8000",
      type: "sale",
    })
    expect(records[0]?.destination).toMatchObject({
      county: "Erie",
      jurisdictionName: "Erie County",
      stateCode: "NY",
    })
  })

  it("classifies disabled collection separately from exempt or nontaxable sales", () => {
    const base = orderFixture()
    const disabledLine = {
      code: "rr_tax:disabled:g4:decision",
      data: {
        collection_mode: "disabled",
        fingerprint,
        generation: 4,
      },
      provider_id: "rate_lookup",
      rate: "0",
    }
    const order = {
      ...base,
      items: base.items.map((item) => ({
        ...item,
        original_tax_total: "0",
        tax_lines: [disabledLine],
      })),
      original_tax_total: "0",
      original_total: "10",
      payment_collections: [
        {
          payments: [
            {
              captured_amount: "10",
              captured_at: base.created_at,
              refunds: [],
            },
          ],
        },
      ],
      summary: { paid_total: "10" },
    }

    const [record] = projectTaxRecords({ orders: [order], period })

    expect(record).toMatchObject({
      collectionMode: "disabled",
      generation: 4,
      nontaxableSales: "0.0000",
      provider: "not_applicable",
      quality: "review",
      taxAmount: "0.0000",
      taxableSales: "0.0000",
      unclassifiedSales: "10.0000",
    })
    expect(record?.issues).toContain(
      "Tax was not collected for this order; confirm the operating decision and filing treatment."
    )
    expect(summarizeTaxRecords(record ? [record] : [])[0]).toMatchObject({
      disabledRecordCount: 1,
      nontaxableSales: "0.0000",
      taxableSales: "0.0000",
      unclassifiedSales: "10.0000",
    })
  })

  it("reconciles shipping omitted from list-level order totals", () => {
    const base = orderFixture()
    const order = {
      ...base,
      payment_collections: [
        {
          payments: [
            {
              captured_amount: "16.2",
              captured_at: base.created_at,
              refunds: [],
            },
          ],
        },
      ],
      original_item_subtotal: "10",
      original_item_tax_total: "0.8",
      original_shipping_subtotal: "5",
      original_shipping_tax_total: "0.4",
      shipping_methods: [],
      summary: {
        original_order_total: "16.2",
        paid_total: "16.2",
      },
    }

    expect(projectTaxRecords({ orders: [order], period })[0]).toMatchObject({
      grossSales: "15.0000",
      issues: [],
      taxAmount: "1.2000",
      total: "16.2000",
    })
  })

  it("keeps legacy sales visible but marks them for review", () => {
    const [record] = projectTaxRecords({
      orders: [orderFixture({ controlled: false })],
      period,
    })

    expect(record).toMatchObject({
      provider: "legacy",
      quality: "review",
    })
    expect(record?.issues).toContain(
      "Legacy tax lines do not include provider-generation evidence."
    )
  })

  it("normalizes tracked state names from legacy shipping addresses", () => {
    const base = orderFixture({ controlled: false })
    const [record] = projectTaxRecords({
      orders: [
        {
          ...base,
          shipping_address: {
            ...base.shipping_address,
            city: "Hartford",
            postal_code: "06103",
            province: "Connecticut",
          },
        },
      ],
      period,
    })

    expect(record?.destination.stateCode).toBe("CT")
    expect(record?.issues).not.toContain(
      "New York filing requires confirming the destination locality and return schedule."
    )
  })

  it("flags Pennsylvania tax rows without local-allocation evidence", () => {
    const base = orderFixture({ controlled: false })
    const [record] = projectTaxRecords({
      orders: [
        {
          ...base,
          shipping_address: {
            ...base.shipping_address,
            city: "Pittsburgh",
            postal_code: "15222",
            province: "Pennsylvania",
          },
        },
      ],
      period,
    })

    expect(record).toMatchObject({
      destination: { stateCode: "PA" },
      quality: "review",
    })
    expect(record?.issues).toContain(
      "Pennsylvania filing requires confirming Philadelphia and Allegheny local-tax allocation."
    )
  })

  it("accepts an explicit Philadelphia destination as local evidence", () => {
    const base = orderFixture({ controlled: false })
    const [record] = projectTaxRecords({
      orders: [
        {
          ...base,
          shipping_address: {
            ...base.shipping_address,
            city: "Philadelphia",
            postal_code: "19103",
            province: "PA",
          },
        },
      ],
      period,
    })

    expect(record?.issues).not.toContain(
      "Pennsylvania filing requires confirming Philadelphia and Allegheny local-tax allocation."
    )
  })

  it("marks a taxed sale with unknown provider evidence incomplete", () => {
    const base = orderFixture()
    const order = {
      ...base,
      items: base.items.map((item) => ({
        ...item,
        tax_lines: [
          {
            code: "unrecognized",
            provider_id: "rate_lookup",
            rate: "8",
          },
        ],
      })),
    }
    const [record] = projectTaxRecords({ orders: [order], period })

    expect(record).toMatchObject({
      provider: "unknown",
      quality: "incomplete",
    })
    expect(record?.issues).toContain("Tax line identity is missing.")
  })

  it("marks an incomplete delivery destination incomplete", () => {
    const base = orderFixture()
    const order = {
      ...base,
      shipping_address: {
        ...base.shipping_address,
        postal_code: null,
      },
    }
    const [record] = projectTaxRecords({ orders: [order], period })

    expect(record).toMatchObject({ quality: "incomplete" })
    expect(record?.issues).toContain("Delivery destination is incomplete.")
  })

  it("records partial refunds in their own period with an explicit estimate", () => {
    const records = projectTaxRecords({
      orders: [
        orderFixture({
          refund: {
            amount: "5.4",
            createdAt: "2026-08-01T13:00:00.000Z",
          },
        }),
      ],
      period,
    })
    const refund = records.find((record) => record.type === "refund")

    expect(refund).toMatchObject({
      grossSales: "5.0000",
      quality: "review",
      refundTaxMethod: "estimated",
      taxAmount: "0.4000",
      total: "5.4000",
    })
    expect(summarizeTaxRecords(records)[0]).toMatchObject({
      currencyCode: "usd",
      grossSales: "10.0000",
      netSales: "5.0000",
      netTax: "0.4000",
      refundCount: 1,
      refundedSales: "5.0000",
      refundedTax: "0.4000",
    })
  })

  it("treats a full refund allocation as exact", () => {
    const records = projectTaxRecords({
      orders: [
        orderFixture({
          refund: {
            amount: "10.8",
            createdAt: "2026-08-01T13:00:00.000Z",
          },
        }),
      ],
      period,
    })
    expect(records.find((record) => record.type === "refund")).toMatchObject({
      quality: "complete",
      refundCreditTiming: "same_period",
      refundTaxMethod: "exact",
    })
  })

  it("marks a credit for a sale from an earlier filing period", () => {
    const records = projectTaxRecords({
      orders: [
        orderFixture({
          createdAt: "2026-05-20T16:00:00.000Z",
          refund: {
            amount: "10.8",
            createdAt: "2026-07-01T13:00:00.000Z",
          },
        }),
      ],
      period: parseTaxReportPeriod({
        endDate: "2026-09-01",
        startDate: "2026-06-01",
      }),
    })
    const refund = records.find((record) => record.type === "refund")

    expect(refund).toMatchObject({
      quality: "review",
      refundCreditTiming: "prior_period",
    })
    expect(refund?.issues.join(" ")).toContain("earlier filing period")
    expect(summarizeTaxRecords(records)[0]).toMatchObject({
      priorPeriodRefundCount: 1,
      samePeriodRefundCount: 0,
    })
  })

  it("marks every affected refund when cumulative credits exceed the sale", () => {
    const records = projectTaxRecords({
      orders: [
        orderFixture({
          refund: [
            {
              amount: "6",
              createdAt: "2026-08-01T13:00:00.000Z",
            },
            {
              amount: "6",
              createdAt: "2026-08-02T13:00:00.000Z",
            },
          ],
        }),
      ],
      period,
    })
    const refunds = records.filter((record) => record.type === "refund")

    expect(refunds).toHaveLength(2)
    expect(
      refunds.every(
        (refund) =>
          refund.quality === "incomplete" &&
          refund.issues.includes(
            "Cumulative refunds exceed the original order total."
          )
      )
    ).toBe(true)
  })

  it("reads Medusa runtime decimal wrappers without zeroing totals", () => {
    const wrapped = (value: string) => new BigNumber(value)
    const base = orderFixture()
    const order = {
      ...base,
      display_id: wrapped("42"),
      items: base.items.map((item) => ({
        ...item,
        raw_original_subtotal: wrapped("10"),
        raw_original_tax_total: wrapped("0.8"),
      })),
      raw_original_subtotal: wrapped("10"),
      raw_original_tax_total: wrapped("0.8"),
      raw_original_total: wrapped("10.8"),
      summary: {
        raw_paid_total: wrapped("10.8"),
      },
    }

    expect(projectTaxRecords({ orders: [order], period })[0]).toMatchObject({
      grossSales: "10.0000",
      taxAmount: "0.8000",
      total: "10.8000",
    })
  })

  it("fails closed instead of silently zeroing an invalid monetary value", () => {
    const base = orderFixture()
    const order = {
      ...base,
      raw_original_total: { value: "not-money" },
    }

    expect(() => projectTaxRecords({ orders: [order], period })).toThrow(
      "Tax projection encountered an invalid monetary value."
    )
  })

  it("does not report unpaid positive-total orders as sales", () => {
    expect(
      projectTaxRecords({
        orders: [orderFixture({ paid: false })],
        period,
      })
    ).toEqual([])
  })

  it("reads captured totals from Medusa payment collections", () => {
    const base = orderFixture()
    const order = {
      ...base,
      payment_collections: [
        {
          captured_amount: "10.8",
          payments: [
            {
              captured_at: "2026-07-20T16:01:00.000Z",
              refunds: [],
            },
          ],
        },
      ],
      summary: undefined,
    }

    expect(projectTaxRecords({ orders: [order], period })[0]).toMatchObject({
      occurredAt: "2026-07-20T16:01:00.000Z",
      total: "10.8000",
      type: "sale",
    })
  })

  it("sums incremental capture records and uses their latest timestamp", () => {
    const base = orderFixture()
    const order = {
      ...base,
      payment_collections: [
        {
          payments: [
            {
              captures: [
                {
                  amount: "5",
                  created_at: "2026-07-20T16:01:00.000Z",
                },
                {
                  amount: "5.8",
                  created_at: "2026-07-20T16:02:00.000Z",
                },
              ],
              refunds: [],
            },
          ],
        },
      ],
      summary: undefined,
    }

    expect(projectTaxRecords({ orders: [order], period })[0]).toMatchObject({
      occurredAt: "2026-07-20T16:02:00.000Z",
      total: "10.8000",
      type: "sale",
    })
  })

  it("marks a captured-total mismatch as incomplete", () => {
    const base = orderFixture()
    const order = {
      ...base,
      payment_collections: [
        {
          payments: [
            {
              captured_amount: "5",
              captured_at: "2026-07-20T16:01:00.000Z",
              refunds: [],
            },
          ],
        },
      ],
      summary: { paid_total: "5" },
    }
    const [record] = projectTaxRecords({ orders: [order], period })

    expect(record).toMatchObject({ quality: "incomplete" })
    expect(record?.issues).toContain(
      "Captured payment does not match the original order total."
    )
  })

  it("does not emit zero-value orders as tax sales", () => {
    const base = orderFixture()
    const order = {
      ...base,
      items: base.items.map((item) => ({
        ...item,
        original_subtotal: "0",
        original_tax_total: "0",
      })),
      original_subtotal: "0",
      original_tax_total: "0",
      original_total: "0",
    }

    expect(projectTaxRecords({ orders: [order], period })).toEqual([])
  })

  it("groups sales and refunds into destination workpapers", () => {
    const records = projectTaxRecords({
      orders: [
        orderFixture({
          refund: {
            amount: "10.8",
            createdAt: "2026-08-01T13:00:00.000Z",
          },
        }),
      ],
      period,
    })

    expect(summarizeDestinations(records)).toEqual([
      expect.objectContaining({
        grossSales: "10.0000",
        currencyCode: "usd",
        refundedSales: "10.0000",
        refundedTax: "0.8000",
        stateCode: "NY",
        taxCollected: "0.8000",
        taxableSales: "0.0000",
      }),
    ])
  })

  it("keeps monetary summaries and destination rows separated by currency", () => {
    const euroOrder = {
      ...orderFixture(),
      currency_code: "eur",
      display_id: 43,
      id: "order_43",
    }
    const records = projectTaxRecords({
      orders: [orderFixture(), euroOrder],
      period,
    })

    expect(summarizeTaxRecords(records)).toEqual([
      expect.objectContaining({
        currencyCode: "eur",
        grossSales: "10.0000",
      }),
      expect.objectContaining({
        currencyCode: "usd",
        grossSales: "10.0000",
      }),
    ])
    expect(summarizeDestinations(records)).toHaveLength(2)
  })
})
