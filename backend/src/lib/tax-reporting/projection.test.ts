import { parseTaxReportPeriod } from "./periods";
import {
  projectTaxRecords,
  summarizeDestinations,
  summarizeTaxRecords,
} from "./projection";

const fingerprint = "a".repeat(43);
const period = parseTaxReportPeriod({
  endDate: "2027-03-01",
  startDate: "2026-03-01",
});

const orderFixture = ({
  controlled = true,
  createdAt = "2026-07-20T16:00:00.000Z",
  paid = true,
  refund,
}: {
  controlled?: boolean;
  createdAt?: string;
  paid?: boolean;
  refund?:
    | { amount: string; createdAt: string }
    | { amount: string; createdAt: string }[];
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
});

describe("tax record projection", () => {
  it("projects a complete controlled sale", () => {
    const records = projectTaxRecords({
      orders: [orderFixture()],
      period,
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      generation: 2,
      grossSales: "10.0000",
      provider: "taxrate_io",
      quality: "complete",
      taxAmount: "0.8000",
      taxableSales: "10.0000",
      total: "10.8000",
      type: "sale",
    });
    expect(records[0]?.destination).toMatchObject({
      county: "Erie",
      jurisdictionName: "Erie County",
      stateCode: "NY",
    });
  });

  it("keeps legacy sales visible but marks them for review", () => {
    const [record] = projectTaxRecords({
      orders: [orderFixture({ controlled: false })],
      period,
    });

    expect(record).toMatchObject({
      provider: "legacy",
      quality: "review",
    });
    expect(record?.issues).toContain(
      "Legacy tax lines do not include provider-generation evidence.",
    );
  });

  it("marks a taxed sale with unknown provider evidence incomplete", () => {
    const base = orderFixture();
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
    };
    const [record] = projectTaxRecords({ orders: [order], period });

    expect(record).toMatchObject({
      provider: "unknown",
      quality: "incomplete",
    });
    expect(record?.issues).toContain("Tax line identity is missing.");
  });

  it("marks an incomplete delivery destination incomplete", () => {
    const base = orderFixture();
    const order = {
      ...base,
      shipping_address: {
        ...base.shipping_address,
        postal_code: null,
      },
    };
    const [record] = projectTaxRecords({ orders: [order], period });

    expect(record).toMatchObject({ quality: "incomplete" });
    expect(record?.issues).toContain("Delivery destination is incomplete.");
  });

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
    });
    const refund = records.find((record) => record.type === "refund");

    expect(refund).toMatchObject({
      grossSales: "5.0000",
      quality: "review",
      refundTaxMethod: "estimated",
      taxAmount: "0.4000",
      total: "5.4000",
    });
    expect(summarizeTaxRecords(records)[0]).toMatchObject({
      currencyCode: "usd",
      grossSales: "10.0000",
      netSales: "5.0000",
      netTax: "0.4000",
      refundCount: 1,
      refundedSales: "5.0000",
      refundedTax: "0.4000",
    });
  });

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
    });
    expect(records.find((record) => record.type === "refund")).toMatchObject({
      quality: "complete",
      refundCreditTiming: "same_period",
      refundTaxMethod: "exact",
    });
  });

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
    });
    const refund = records.find((record) => record.type === "refund");

    expect(refund).toMatchObject({
      quality: "review",
      refundCreditTiming: "prior_period",
    });
    expect(refund?.issues.join(" ")).toContain("earlier filing period");
    expect(summarizeTaxRecords(records)[0]).toMatchObject({
      priorPeriodRefundCount: 1,
      samePeriodRefundCount: 0,
    });
  });

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
    });
    const refunds = records.filter((record) => record.type === "refund");

    expect(refunds).toHaveLength(2);
    expect(
      refunds.every(
        (refund) =>
          refund.quality === "incomplete" &&
          refund.issues.includes(
            "Cumulative refunds exceed the original order total.",
          ),
      ),
    ).toBe(true);
  });

  it("reads Medusa runtime decimal wrappers without zeroing totals", () => {
    const wrapped = (value: string) => ({
      value: { toString: () => value },
    });
    const base = orderFixture();
    const order = {
      ...base,
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
    };

    expect(
      projectTaxRecords({ orders: [order], period })[0],
    ).toMatchObject({
      grossSales: "10.0000",
      taxAmount: "0.8000",
      total: "10.8000",
    });
  });

  it("does not report unpaid positive-total orders as sales", () => {
    expect(
      projectTaxRecords({
        orders: [orderFixture({ paid: false })],
        period,
      }),
    ).toEqual([]);
  });

  it("marks a captured-total mismatch as incomplete", () => {
    const base = orderFixture();
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
    };
    const [record] = projectTaxRecords({ orders: [order], period });

    expect(record).toMatchObject({ quality: "incomplete" });
    expect(record?.issues).toContain(
      "Captured payment does not match the original order total.",
    );
  });

  it("does not emit zero-value orders as tax sales", () => {
    const base = orderFixture();
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
    };

    expect(projectTaxRecords({ orders: [order], period })).toEqual([]);
  });

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
    });

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
    ]);
  });

  it("keeps monetary summaries and destination rows separated by currency", () => {
    const euroOrder = {
      ...orderFixture(),
      currency_code: "eur",
      display_id: 43,
      id: "order_43",
    };
    const records = projectTaxRecords({
      orders: [orderFixture(), euroOrder],
      period,
    });

    expect(summarizeTaxRecords(records)).toEqual([
      expect.objectContaining({
        currencyCode: "eur",
        grossSales: "10.0000",
      }),
      expect.objectContaining({
        currencyCode: "usd",
        grossSales: "10.0000",
      }),
    ]);
    expect(summarizeDestinations(records)).toHaveLength(2);
  });
});
