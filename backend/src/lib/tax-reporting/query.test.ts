import type { MedusaContainer } from "@medusajs/framework/types";

import { parseTaxReportPeriod } from "./periods";
import {
  buildFullTaxReport,
  buildTaxReport,
  loadTaxReportOrders,
  parseTaxReportFilters,
} from "./query";

const period = parseTaxReportPeriod({
  endDate: "2026-09-01",
  startDate: "2026-06-01",
});

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
};

const containerWith = (
  graph: (input: Record<string, unknown>) => Promise<{
    data: Record<string, unknown>[];
  }>,
): MedusaContainer =>
  ({
    resolve: () => ({ graph }),
  }) as unknown as MedusaContainer;

describe("tax report query", () => {
  it("parses bounded table filters and rejects unsafe values", () => {
    expect(parseTaxReportFilters(new URLSearchParams())).toMatchObject({
      limit: 50,
      page: 1,
      provider: "all",
      state: "ALL",
    });
    expect(() =>
      parseTaxReportFilters(new URLSearchParams({ limit: "1000" })),
    ).toThrow();
    expect(() =>
      parseTaxReportFilters(new URLSearchParams({ state: "NY;DROP" })),
    ).toThrow();
  });

  it("scans orders before period end so older-sale refunds remain available", async () => {
    let capturedInput: Record<string, unknown> | null = null;
    const result = await loadTaxReportOrders({
      container: containerWith(async (input) => {
        capturedInput = input;
        return { data: [] };
      }),
      period,
    });

    expect(result).toEqual({ orders: [], truncated: false });
    expect(capturedInput).toMatchObject({
      entity: "order",
      fields: expect.arrayContaining([
        "*items.tax_lines",
        "*payment_collections",
        "*payment_collections.payments",
        "*payment_collections.payments.captures",
        "*payment_collections.payments.refunds",
        "*shipping_address",
        "*shipping_methods.tax_lines",
        "payment_collections.id",
        "payment_collections.captured_amount",
        "payment_collections.payments.id",
        "payment_collections.payments.captures.amount",
        "payment_collections.payments.captures.created_at",
      ]),
      filters: {
        created_at: { $lt: period.endExclusive },
      },
    });
  });

  it("hydrates authoritative capture data from the Payment Module", async () => {
    let paymentQuery: Record<string, unknown> | null = null;
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
    };
    const report = await buildFullTaxReport({
      container: containerWith(async (input) => {
        if (input.entity === "payment") {
          paymentQuery = input;
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
          };
        }
        return { data: [sparseOrder] };
      }),
      period,
    });

    expect(paymentQuery).toMatchObject({
      entity: "payment",
      fields: expect.arrayContaining([
        "amount",
        "captures.amount",
        "captures.created_at",
        "refunds.amount",
      ]),
      filters: { id: ["pay_42"] },
    });
    expect(report.records).toEqual([
      expect.objectContaining({
        grossSales: "10.0000",
        occurredAt: "2026-07-20T16:01:00.000Z",
        taxAmount: "0.8000",
        total: "10.8000",
      }),
    ]);
  });

  it("fails closed when a linked payment cannot be hydrated", async () => {
    const sparseOrder = {
      ...order,
      payment_collections: [
        {
          payments: [{ id: "pay_missing" }],
        },
      ],
      summary: undefined,
    };

    await expect(
      buildFullTaxReport({
        container: containerWith(async (input) => ({
          data: input.entity === "payment" ? [] : [sparseOrder],
        })),
        period,
      }),
    ).rejects.toThrow(
      "Tax report could not load every linked payment record.",
    );
  });

  it("keeps period summaries complete when table filters match no rows", async () => {
    const report = await buildTaxReport({
      container: containerWith(async () => ({ data: [order] })),
      filters: parseTaxReportFilters(
        new URLSearchParams({ quality: "incomplete" }),
      ),
      period,
    });

    expect(report.resultCount).toBe(0);
    expect(report.records).toEqual([]);
    expect(report.filters.currencies).toEqual(["usd"]);
    expect(report.summaries[0]).toMatchObject({
      currencyCode: "usd",
      grossSales: "10.0000",
      reviewRecords: 1,
      taxCollected: "0.8000",
    });
  });

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
    });

    expect(report.resultCount).toBe(0);
    expect(report.summaries[0]?.grossSales).toBe("10.0000");
  });

  it("searches privacy-safe order and destination fields", async () => {
    const report = await buildTaxReport({
      container: containerWith(async () => ({ data: [order] })),
      filters: parseTaxReportFilters(new URLSearchParams({ q: "Buffalo" })),
      period,
    });

    expect(report.resultCount).toBe(1);
    expect(report.records[0]?.displayId).toBe(42);
  });

  it("builds an unpaginated full-period export model", async () => {
    const report = await buildFullTaxReport({
      container: containerWith(async () => ({ data: [order] })),
      period,
    });

    expect(report.records).toHaveLength(1);
    expect(report.destinations).toHaveLength(1);
    expect(report.summaries[0]).toMatchObject({
      currencyCode: "usd",
      netTax: "0.8000",
    });
  });
});
