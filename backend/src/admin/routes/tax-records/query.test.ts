import { requestAdminJson } from "../../lib/admin-request";
import { taxRecordsQueryOptions, taxRecordsReportSchema } from "./query";

jest.mock("../../lib/admin-request", () => ({
  requestAdminJson: jest.fn(),
}));

const validReport = {
  destinations: [
    {
      city: "Hartford",
      countryCode: "US",
      county: "Hartford",
      currencyCode: "usd",
      grossSales: "106.35",
      jurisdictionLevel: "state",
      jurisdictionName: "Connecticut",
      netSales: "106.35",
      netTax: "6.35",
      nontaxableSales: "0.00",
      postalCode: "06103",
      refundedSales: "0.00",
      refundedTax: "0.00",
      stateCode: "CT",
      taxCollected: "6.35",
      taxRatePercent: "6.350",
      taxableSales: "100.00",
      unclassifiedSales: "0.00",
    },
  ],
  filingState: "CT",
  filters: {
    collectionModes: ["collect"],
    currencies: ["usd"],
    providers: ["stripe_tax"],
    states: ["CT"],
  },
  generatedAt: "2026-07-27T05:00:00.000Z",
  period: {
    endDate: "2026-07-01",
    endExclusive: "2026-07-01T04:00:00.000Z",
    label: "Apr 1, 2026 – Jun 30, 2026",
    startDate: "2026-04-01",
    startInclusive: "2026-04-01T04:00:00.000Z",
    timeZone: "America/New_York",
  },
  records: [
    {
      collectionMode: "collect",
      currencyCode: "usd",
      destination: {
        city: "Hartford",
        countryCode: "US",
        county: "Hartford",
        jurisdictionLevel: "state",
        jurisdictionName: "Connecticut",
        postalCode: "06103",
        stateCode: "CT",
      },
      displayId: 42,
      generation: 1,
      grossSales: "106.35",
      id: "order_01:sale",
      issues: [],
      nontaxableSales: "0.00",
      occurredAt: "2026-06-15T12:00:00.000Z",
      orderId: "order_01",
      provider: "stripe_tax",
      quality: "complete",
      refundCreditTiming: null,
      refundId: null,
      refundTaxMethod: null,
      taxAmount: "6.35",
      taxCalculationId: "taxcalc_01",
      taxableSales: "100.00",
      taxRatePercent: "6.350",
      total: "106.35",
      type: "sale",
      unclassifiedSales: "0.00",
    },
  ],
  resultCount: 1,
  source: {
    medusaOrdersScanned: 5,
    scopedRecords: 1,
    truncated: false,
    unassignedStateRecords: 0,
  },
  summaries: [
    {
      completeRecords: 1,
      currencyCode: "usd",
      disabledRecordCount: 0,
      grossSales: "106.35",
      incompleteRecords: 0,
      netSales: "106.35",
      netTax: "6.35",
      nontaxableSales: "0.00",
      orderCount: 1,
      priorPeriodRefundCount: 0,
      refundCount: 0,
      refundedSales: "0.00",
      refundedTax: "0.00",
      reviewRecords: 0,
      samePeriodRefundCount: 0,
      taxCollected: "6.35",
      taxableSales: "100.00",
      unclassifiedSales: "0.00",
    },
  ],
  unassignedRecordExamples: [],
} as const;

const input = {
  filingState: "CT",
  filters: {
    collectionMode: "collect",
    limit: 50,
    page: 2,
    provider: "stripe_tax",
    q: "Buffalo",
    quality: "complete",
    type: "sale",
  },
  period: {
    end: "2026-07-01",
    start: "2026-04-01",
  },
} as const;

describe("tax records query", () => {
  beforeEach(() => {
    jest.mocked(requestAdminJson).mockReset();
  });

  it("accepts a complete state filing report", () => {
    expect(taxRecordsReportSchema.parse(validReport)).toEqual(validReport);
  });

  it("rejects malformed money, currency, and bounded counts", () => {
    expect(() =>
      taxRecordsReportSchema.parse({
        ...validReport,
        source: {
          ...validReport.source,
          scopedRecords: -1,
        },
        summaries: [
          {
            ...validReport.summaries[0],
            currencyCode: "US",
            netTax: "not-money",
          },
        ],
      }),
    ).toThrow();
  });

  it("forwards the complete selection and Query cancellation", async () => {
    jest.mocked(requestAdminJson).mockResolvedValue(validReport);
    const options = taxRecordsQueryOptions(input);
    const controller = new AbortController();

    await expect(
      options.queryFn?.({
        meta: undefined,
        queryKey: options.queryKey,
        signal: controller.signal,
      }),
    ).resolves.toEqual(validReport);

    expect(requestAdminJson).toHaveBeenCalledWith({
      path: "/admin/tax-records",
      query: {
        collection_mode: "collect",
        end: "2026-07-01",
        filing_state: "CT",
        limit: 50,
        page: 2,
        provider: "stripe_tax",
        q: "Buffalo",
        quality: "complete",
        start: "2026-04-01",
        type: "sale",
      },
      schema: taxRecordsReportSchema,
      signal: controller.signal,
      timeoutMs: 20_000,
    });
    expect(options.placeholderData).toBeDefined();
    expect(options.retry).toBe(false);
    expect(options.staleTime).toBe(0);
  });
});
