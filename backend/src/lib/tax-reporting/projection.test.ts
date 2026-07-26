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
  paid = true,
  refund,
}: {
  controlled?: boolean;
  paid?: boolean;
  refund?: { amount: string; createdAt: string };
} = {}) => ({
  created_at: "2026-07-20T16:00:00.000Z",
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
          captured_at: paid ? "2026-07-20T16:01:00.000Z" : null,
          refunds: refund
            ? [
                {
                  amount: refund.amount,
                  created_at: refund.createdAt,
                  id: "refund_42",
                },
              ]
            : [],
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
    expect(summarizeTaxRecords(records)).toMatchObject({
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
      refundTaxMethod: "exact",
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
        refundedSales: "10.0000",
        refundedTax: "0.8000",
        stateCode: "NY",
        taxCollected: "0.8000",
        taxableSales: "0.0000",
      }),
    ]);
  });
});
