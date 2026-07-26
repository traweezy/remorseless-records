import { taxTransactionsCsv } from "./csv";
import { parseTaxReportPeriod } from "./periods";
import type { TaxRecord } from "./types";

const period = parseTaxReportPeriod({
  endDate: "2027-03-01",
  startDate: "2026-03-01",
});

describe("tax reporting CSV", () => {
  it("uses signed refund rows and neutralizes spreadsheet formulas", () => {
    const record: TaxRecord = {
      currencyCode: "usd",
      destination: {
        city: "=cmd()",
        countryCode: "US",
        county: null,
        jurisdictionLevel: null,
        jurisdictionName: null,
        postalCode: "14201",
        stateCode: "NY",
      },
      displayId: 1,
      generation: null,
      grossSales: "5.0000",
      id: "refund:1",
      issues: ["+review"],
      nontaxableSales: "0.0000",
      occurredAt: "2026-07-20T12:00:00.000Z",
      orderId: "order_1",
      provider: "legacy",
      quality: "review",
      refundId: "refund_1",
      refundTaxMethod: "estimated",
      taxAmount: "0.4000",
      taxableSales: "5.0000",
      taxCalculationId: null,
      taxRatePercent: "8.000000",
      total: "5.4000",
      type: "refund",
    };
    const csv = taxTransactionsCsv({
      generatedAt: "2026-07-21T12:00:00.000Z",
      period,
      records: [record],
      summary: {
        completeRecords: 0,
        grossSales: "0.0000",
        incompleteRecords: 0,
        netSales: "-5.0000",
        netTax: "-0.4000",
        nontaxableSales: "0.0000",
        orderCount: 0,
        refundCount: 1,
        refundedSales: "5.0000",
        refundedTax: "0.4000",
        reviewRecords: 1,
        taxCollected: "0.0000",
        taxableSales: "-5.0000",
      },
    });

    expect(csv.startsWith("\uFEFFrecord_type")).toBe(true);
    expect(csv).toContain(",-5.0000,");
    expect(csv).toContain("'=cmd()");
    expect(csv).toContain("'+review");
  });
});
