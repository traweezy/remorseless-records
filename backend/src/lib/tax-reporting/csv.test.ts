import { taxDestinationsCsv, taxTransactionsCsv } from "./csv";
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
      refundCreditTiming: "prior_period",
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
      filingState: "NY",
      generatedAt: "2026-07-21T12:00:00.000Z",
      period,
      records: [record],
      summaries: [{
        completeRecords: 0,
        currencyCode: "usd",
        grossSales: "0.0000",
        incompleteRecords: 0,
        netSales: "-5.0000",
        netTax: "-0.4000",
        nontaxableSales: "0.0000",
        orderCount: 0,
        priorPeriodRefundCount: 1,
        refundCount: 1,
        refundedSales: "5.0000",
        refundedTax: "0.4000",
        reviewRecords: 1,
        samePeriodRefundCount: 0,
        taxCollected: "0.0000",
        taxableSales: "-5.0000",
      }],
    });

    expect(csv.startsWith("\uFEFFrecord_type")).toBe(true);
    expect(csv).toContain("refund,NY,'=cmd() 14201 — verify locality");
    expect(csv).toContain(",-5.0000,");
    expect(csv).toContain("'=cmd()");
    expect(csv).toContain("'+review");
    expect(csv).toContain("prior_period");
  });

  it("preserves each destination and summary currency", () => {
    const summaries = [
      {
        completeRecords: 1,
        currencyCode: "eur",
        grossSales: "10.0000",
        incompleteRecords: 0,
        netSales: "10.0000",
        netTax: "0.8000",
        nontaxableSales: "0.0000",
        orderCount: 1,
        priorPeriodRefundCount: 0,
        refundCount: 0,
        refundedSales: "0.0000",
        refundedTax: "0.0000",
        reviewRecords: 0,
        samePeriodRefundCount: 0,
        taxCollected: "0.8000",
        taxableSales: "10.0000",
      },
    ];
    const csv = taxDestinationsCsv({
      destinations: [
        {
          city: "Paris",
          countryCode: "FR",
          county: null,
          currencyCode: "eur",
          grossSales: "10.0000",
          jurisdictionLevel: null,
          jurisdictionName: null,
          netSales: "10.0000",
          netTax: "0.8000",
          nontaxableSales: "0.0000",
          postalCode: "75001",
          refundedSales: "0.0000",
          refundedTax: "0.0000",
          stateCode: "IDF",
          taxCollected: "0.8000",
          taxableSales: "10.0000",
          taxRatePercent: "8.000000",
        },
      ],
      filingState: "ALL",
      generatedAt: "2026-07-21T12:00:00.000Z",
      period,
      summaries,
    });

    expect(csv).toContain("IDF,");
    expect(csv).toContain(",eur,10.0000,");
    expect(csv).toContain("eur,10.0000,0.0000,10.0000");
  });

  it("adds state-specific filing buckets to destination workpapers", () => {
    const csv = taxDestinationsCsv({
      destinations: [
        {
          city: "Philadelphia",
          countryCode: "US",
          county: "Philadelphia",
          currencyCode: "usd",
          grossSales: "10.0000",
          jurisdictionLevel: "city",
          jurisdictionName: "Philadelphia",
          netSales: "10.0000",
          netTax: "0.8000",
          nontaxableSales: "0.0000",
          postalCode: "19103",
          refundedSales: "0.0000",
          refundedTax: "0.0000",
          stateCode: "PA",
          taxCollected: "0.8000",
          taxableSales: "10.0000",
          taxRatePercent: "8.000000",
        },
      ],
      filingState: "PA",
      generatedAt: "2026-07-21T12:00:00.000Z",
      period,
      summaries: [],
    });

    expect(csv).toContain(
      "filing_state,filing_bucket,country_code,state_code",
    );
    expect(csv).toContain("PA,Philadelphia local,US,PA");
    expect(csv).toContain("filing_state,PA");
  });
});
