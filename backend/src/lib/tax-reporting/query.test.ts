import type { MedusaContainer } from "@medusajs/framework/types"

import { parseTaxReportPeriod } from "./periods"
import {
  buildFullTaxReport,
  buildTaxReport,
  loadTaxReportOrders,
  parseTaxReportFilters,
} from "./query"

const mockGetOrdersListRun = jest.fn()

jest.mock("@medusajs/core-flows", () => ({
  getOrdersListWorkflow: () => ({ run: mockGetOrdersListRun }),
}))

const period = parseTaxReportPeriod({
  endDate: "2026-09-01",
  startDate: "2026-06-01",
})

const order = {
  created_at: "2026-07-20T16:00:00.000Z",
  currency_code: "usd",
  display_id: 42,
  id: "order_42",
  items: [
    {
      id: "item_42",
      original_subtotal: "10",
      tax_lines: [
        {
          code: "sales_tax",
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
          captured_amount: "10.8",
          captured_at: "2026-07-20T16:01:00.000Z",
          refunds: [],
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
  summary: { paid_total: "10.8" },
}

const containerWith = (
  graph: (input: Record<string, unknown>) => Promise<{
    data: unknown[]
  }>
): MedusaContainer => {
  mockGetOrdersListRun.mockImplementation(
    async ({
      input,
    }: {
      input: {
        fields: string[]
        variables: Record<string, unknown> & {
          order: Record<string, "ASC" | "DESC">
          skip: number
          take: number
        }
      }
    }) => {
      const { order: orderBy, skip, take, ...filters } = input.variables
      const { data } = await graph({
        entity: "orders",
        fields: input.fields,
        filters,
        pagination: { order: orderBy, skip, take },
      })
      return {
        result: {
          metadata: { count: data.length, skip, take },
          rows: data,
        },
      }
    }
  )
  return {
    resolve: () => ({ graph }),
  } as unknown as MedusaContainer
}

describe("tax report query", () => {
  it("parses bounded table filters and rejects unsafe values", () => {
    expect(parseTaxReportFilters(new URLSearchParams())).toMatchObject({
      filingState: "ALL",
      limit: 50,
      page: 1,
      provider: "all",
      state: "ALL",
    })
    expect(() =>
      parseTaxReportFilters(new URLSearchParams({ limit: "1000" }))
    ).toThrow()
    expect(() =>
      parseTaxReportFilters(new URLSearchParams({ state: "NY;DROP" }))
    ).toThrow()
    expect(() =>
      parseTaxReportFilters(new URLSearchParams({ filing_state: "NJ" }))
    ).toThrow()
  })

  it("scans orders before period end so older-sale refunds remain available", async () => {
    const capturedInputs: Record<string, unknown>[] = []
    const result = await loadTaxReportOrders({
      container: containerWith(async (input) => {
        capturedInputs.push(input)
        return { data: [] }
      }),
      period,
    })

    expect(result).toEqual({ orders: [], truncated: false })
    expect(capturedInputs).toHaveLength(2)
    const fullInput = capturedInputs.find((input) =>
      (input.fields as string[]).includes("*payment_collections")
    )
    const totalsInput = capturedInputs.find(
      (input) => !(input.fields as string[]).includes("*payment_collections")
    )
    expect(fullInput).toMatchObject({
      entity: "orders",
      fields: expect.arrayContaining([
        "*items.tax_lines",
        "*payment_collections",
        "*payment_collections.payments",
        "*payment_collections.payments.captures",
        "*payment_collections.payments.refunds",
        "*shipping_address",
        "*shipping_methods.tax_lines",
        "original_item_subtotal",
        "original_item_tax_total",
        "original_shipping_subtotal",
        "original_shipping_tax_total",
        "raw_original_item_subtotal",
        "raw_original_item_tax_total",
        "raw_original_shipping_subtotal",
        "raw_original_shipping_tax_total",
        "payment_collections.id",
        "payment_collections.captured_amount",
        "payment_collections.payments.id",
        "payment_collections.payments.captures.amount",
        "payment_collections.payments.captures.created_at",
      ]),
      filters: {
        created_at: { $lt: period.endExclusive },
      },
    })
    expect(totalsInput).toMatchObject({
      entity: "orders",
      fields: expect.arrayContaining([
        "original_item_subtotal",
        "original_item_tax_total",
        "original_shipping_subtotal",
        "original_shipping_tax_total",
        "original_subtotal",
        "original_tax_total",
        "original_total",
      ]),
      filters: {
        created_at: { $lt: period.endExclusive },
      },
    })
  })

  it("merges a totals-only workflow result into the full order page", async () => {
    const fullOrder = {
      ...order,
      original_subtotal: "10",
      original_tax_total: "0.8",
      original_total: "10.8",
      shipping_methods: [],
      summary: {
        original_order_total: "16.2",
        paid_total: "16.2",
      },
      payment_collections: [
        {
          payments: [
            {
              captured_amount: "16.2",
              captured_at: "2026-07-20T16:01:00.000Z",
              refunds: [],
            },
          ],
        },
      ],
    }
    const authoritativeTotals = {
      id: order.id,
      original_item_subtotal: "10",
      original_item_tax_total: "0.8",
      original_shipping_subtotal: "5",
      original_shipping_tax_total: "0.4",
      original_subtotal: "15",
      original_tax_total: "1.2",
      original_total: "16.2",
    }
    const report = await buildFullTaxReport({
      container: containerWith(async (input) => ({
        data: (input.fields as string[]).includes("*payment_collections")
          ? [fullOrder]
          : [authoritativeTotals],
      })),
      period,
    })

    expect(report.records).toEqual([
      expect.objectContaining({
        grossSales: "15.0000",
        issues: [
          "Legacy tax lines do not include provider-generation evidence.",
          "New York filing requires confirming the destination locality and return schedule.",
        ],
        taxAmount: "1.2000",
        total: "16.2000",
      }),
    ])
  })

  it("fails closed when the totals-only result omits an order", async () => {
    await expect(
      loadTaxReportOrders({
        container: containerWith(async (input) => ({
          data: (input.fields as string[]).includes("*payment_collections")
            ? [order]
            : [],
        })),
        period,
      })
    ).rejects.toThrow(
      "Tax report could not load authoritative totals for every order."
    )
  })

  it("fails closed when an order workflow returns a non-record row", async () => {
    await expect(
      loadTaxReportOrders({
        container: containerWith(async () => ({ data: [null] })),
        period,
      })
    ).rejects.toThrow(
      "Tax report order workflow returned malformed structured data."
    )
  })

  it("hydrates authoritative capture data from the Payment Module", async () => {
    let paymentQuery: Record<string, unknown> | null = null
    const sparseOrder = {
      ...order,
      payment_collections: [
        {
          payments: [
            {
              captured_at: "2026-07-20T16:01:00.000Z",
              id: "pay_42",
            },
          ],
        },
      ],
      summary: undefined,
    }
    const report = await buildFullTaxReport({
      container: containerWith(async (input) => {
        if (input.entity === "payment") {
          paymentQuery = input
          return {
            data: [
              {
                amount: "10.8",
                captured_at: "2026-07-20T16:01:00.000Z",
                captures: [
                  {
                    amount: "10.8",
                    created_at: "2026-07-20T16:01:00.000Z",
                    id: "capt_42",
                  },
                ],
                id: "pay_42",
                refunds: [],
              },
            ],
          }
        }
        return { data: [sparseOrder] }
      }),
      period,
    })

    expect(paymentQuery).toMatchObject({
      entity: "payment",
      fields: expect.arrayContaining([
        "amount",
        "captures.amount",
        "captures.created_at",
        "refunds.amount",
      ]),
      filters: { id: ["pay_42"] },
    })
    expect(report.records).toEqual([
      expect.objectContaining({
        grossSales: "10.0000",
        occurredAt: "2026-07-20T16:01:00.000Z",
        taxAmount: "0.8000",
        total: "10.8000",
      }),
    ])
    expect(report.source).toMatchObject({
      medusaOrdersScanned: 1,
      projectedRecords: 1,
      relationships: {
        ordersWithItems: 1,
        ordersWithPaymentCollections: 1,
        ordersWithPayments: 1,
        ordersWithShippingAddress: 1,
        ordersWithSummary: 0,
        paymentCollections: 1,
        payments: 1,
      },
    })
  })

  it("fails closed when a linked payment cannot be hydrated", async () => {
    const sparseOrder = {
      ...order,
      payment_collections: [
        {
          payments: [{ id: "pay_missing" }],
        },
      ],
      summary: undefined,
    }

    await expect(
      buildFullTaxReport({
        container: containerWith(async (input) => ({
          data: input.entity === "payment" ? [] : [sparseOrder],
        })),
        period,
      })
    ).rejects.toThrow("Tax report could not load every linked payment record.")
  })

  it("fails closed when the payment graph returns a non-record row", async () => {
    const sparseOrder = {
      ...order,
      payment_collections: [
        {
          payments: [{ id: "pay_invalid" }],
        },
      ],
    }

    await expect(
      buildFullTaxReport({
        container: containerWith(async (input) => ({
          data: input.entity === "payment" ? [false] : [sparseOrder],
        })),
        period,
      })
    ).rejects.toThrow(
      "Tax report payment query returned malformed structured data."
    )
  })

  it("keeps period summaries complete when table filters match no rows", async () => {
    const report = await buildTaxReport({
      container: containerWith(async () => ({ data: [order] })),
      filters: parseTaxReportFilters(
        new URLSearchParams({ quality: "incomplete" })
      ),
      period,
    })

    expect(report.resultCount).toBe(0)
    expect(report.records).toEqual([])
    expect(report.filters.currencies).toEqual(["usd"])
    expect(report.summaries[0]).toMatchObject({
      currencyCode: "usd",
      grossSales: "10.0000",
      reviewRecords: 1,
      taxCollected: "0.8000",
    })
  })

  it("scopes records, totals, and destinations before table filtering", async () => {
    const connecticutOrder = {
      ...order,
      display_id: 43,
      id: "order_ct",
      shipping_address: {
        ...order.shipping_address,
        city: "Hartford",
        postal_code: "06103",
        province: "Connecticut",
      },
    }
    const report = await buildTaxReport({
      container: containerWith(async () => ({
        data: [order, connecticutOrder],
      })),
      filters: parseTaxReportFilters(
        new URLSearchParams({ filing_state: "CT" })
      ),
      period,
    })

    expect(report.filingState).toBe("CT")
    expect(report.records).toEqual([
      expect.objectContaining({
        destination: expect.objectContaining({ stateCode: "CT" }),
        displayId: 43,
      }),
    ])
    expect(report.destinations).toEqual([
      expect.objectContaining({ stateCode: "CT" }),
    ])
    expect(report.filters.states).toEqual(["CT"])
    expect(report.summaries[0]).toMatchObject({
      grossSales: "10.0000",
      orderCount: 1,
    })
    expect(report.source).toMatchObject({
      projectedRecords: 2,
      scopedRecords: 1,
      unassignedStateRecords: 0,
    })
  })

  it("reports domestic records that cannot be assigned to a filing state", async () => {
    const unassigned = {
      ...order,
      shipping_address: {
        ...order.shipping_address,
        country_code: null,
        province: null,
      },
    }
    const report = await buildTaxReport({
      container: containerWith(async () => ({ data: [unassigned] })),
      filters: parseTaxReportFilters(
        new URLSearchParams({ filing_state: "PA" })
      ),
      period,
    })

    expect(report.records).toEqual([])
    expect(report.source).toMatchObject({
      projectedRecords: 1,
      scopedRecords: 0,
      unassignedStateRecords: 1,
    })
    expect(report.unassignedRecordExamples).toEqual([
      expect.objectContaining({
        displayId: 42,
        orderId: "order_42",
      }),
    ])
    expect(report.summaries[0]).toMatchObject({
      grossSales: "0.0000",
      orderCount: 0,
    })
  })

  it("keeps a tracked state visible when its country is missing", async () => {
    const connecticutOrder = {
      ...order,
      shipping_address: {
        ...order.shipping_address,
        city: "Hartford",
        country_code: null,
        postal_code: "06103",
        province: "Connecticut",
      },
    }
    const report = await buildTaxReport({
      container: containerWith(async () => ({
        data: [connecticutOrder],
      })),
      filters: parseTaxReportFilters(
        new URLSearchParams({ filing_state: "CT" })
      ),
      period,
    })

    expect(report.records).toEqual([
      expect.objectContaining({
        destination: expect.objectContaining({
          countryCode: null,
          stateCode: "CT",
        }),
        quality: "incomplete",
      }),
    ])
    expect(report.source.unassignedStateRecords).toBe(0)
  })

  it.each([
    ["provider", new URLSearchParams({ provider: "stripe_tax" })],
    ["quality", new URLSearchParams({ quality: "complete" })],
    ["record type", new URLSearchParams({ type: "refund" })],
    ["state", new URLSearchParams({ state: "CA" })],
    ["search", new URLSearchParams({ q: "not-present" })],
  ])("applies the %s table filter", async (_label, searchParams) => {
    const report = await buildTaxReport({
      container: containerWith(async () => ({ data: [order] })),
      filters: parseTaxReportFilters(searchParams),
      period,
    })

    expect(report.resultCount).toBe(0)
    expect(report.summaries[0]?.grossSales).toBe("10.0000")
  })

  it("searches privacy-safe order and destination fields", async () => {
    const report = await buildTaxReport({
      container: containerWith(async () => ({ data: [order] })),
      filters: parseTaxReportFilters(new URLSearchParams({ q: "Buffalo" })),
      period,
    })

    expect(report.resultCount).toBe(1)
    expect(report.records[0]?.displayId).toBe(42)
  })

  it("builds an unpaginated full-period export model", async () => {
    const report = await buildFullTaxReport({
      container: containerWith(async () => ({ data: [order] })),
      filingState: "NY",
      period,
    })

    expect(report.filingState).toBe("NY")
    expect(report.records).toHaveLength(1)
    expect(report.destinations).toHaveLength(1)
    expect(report.summaries[0]).toMatchObject({
      currencyCode: "usd",
      netTax: "0.8000",
    })
  })
})
