import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import {
  taxDestinationsCsv,
  taxTransactionsCsv,
} from "../../../../lib/tax-reporting/csv";
import { buildFullTaxReport } from "../../../../lib/tax-reporting/query";

import { GET } from "./route";

jest.mock("../../../../lib/tax-reporting/csv", () => ({
  taxDestinationsCsv: jest.fn(() => "destination csv"),
  taxTransactionsCsv: jest.fn(() => "transaction csv"),
}));
jest.mock("../../../../lib/tax-reporting/query", () => {
  const actual = jest.requireActual(
    "../../../../lib/tax-reporting/query",
  ) as object;
  return {
    ...actual,
    buildFullTaxReport: jest.fn(),
  };
});

const buildFullTaxReportMock =
  buildFullTaxReport as jest.MockedFunction<typeof buildFullTaxReport>;
const destinationsCsvMock =
  taxDestinationsCsv as jest.MockedFunction<typeof taxDestinationsCsv>;
const transactionsCsvMock =
  taxTransactionsCsv as jest.MockedFunction<typeof taxTransactionsCsv>;

type ResponseState = {
  body: unknown;
  headers: Record<string, string>;
  status: number;
  type: string | null;
};

const responseFixture = (): {
  res: MedusaResponse;
  state: ResponseState;
} => {
  const state: ResponseState = {
    body: null,
    headers: {},
    status: 200,
    type: null,
  };
  const response = {} as MedusaResponse;
  response.setHeader = jest.fn((name: string, value: string) => {
    state.headers[name.toLowerCase()] = value;
    return response;
  }) as MedusaResponse["setHeader"];
  response.status = jest.fn((status: number) => {
    state.status = status;
    return response;
  }) as MedusaResponse["status"];
  response.type = jest.fn((value: string) => {
    state.type = value;
    return response;
  }) as MedusaResponse["type"];
  response.json = jest.fn((body: unknown) => {
    state.body = body;
    return response;
  }) as MedusaResponse["json"];
  response.send = jest.fn((body: unknown) => {
    state.body = body;
    return response;
  }) as MedusaResponse["send"];
  return { res: response, state };
};

const requestFixture = (
  originalUrl =
    "/admin/tax-records/export?format=transactions&filing_state=PA&start=2026-01-01&end=2026-04-01",
): AuthenticatedMedusaRequest =>
  ({
    originalUrl,
    scope: {
      resolve: jest.fn(() => ({ error: jest.fn() })),
    },
  }) as unknown as AuthenticatedMedusaRequest;

const reportFixture = ({
  unassignedDomesticRecords = 0,
}: {
  unassignedDomesticRecords?: number;
} = {}) =>
  ({
    destinations: [],
    filingState: "PA",
    generatedAt: "2026-07-26T12:00:00.000Z",
    period: {
      endDate: "2026-04-01",
      endExclusive: "2026-04-01T04:00:00.000Z",
      label: "Jan 1, 2026 – Mar 31, 2026",
      startDate: "2026-01-01",
      startInclusive: "2026-01-01T05:00:00.000Z",
      timeZone: "America/New_York",
    },
    records: [],
    source: {
      medusaOrdersScanned: 0,
      projectedRecords: 0,
      projectionDiagnostics: null,
      relationships: {
        ordersWithItems: 0,
        ordersWithPaymentCollections: 0,
        ordersWithPayments: 0,
        ordersWithShippingAddress: 0,
        ordersWithSummary: 0,
        paymentCollections: 0,
        payments: 0,
      },
      scopedRecords: 0,
      truncated: false,
      unassignedDomesticRecords,
    },
    summaries: [],
  }) as Awaited<ReturnType<typeof buildFullTaxReport>>;

beforeEach(() => {
  jest.clearAllMocks();
  buildFullTaxReportMock.mockResolvedValue(reportFixture());
});

describe("GET /admin/tax-records/export", () => {
  it("scopes the export and filename to the selected filing state", async () => {
    const { res, state } = responseFixture();

    await GET(requestFixture(), res);

    expect(buildFullTaxReportMock).toHaveBeenCalledWith(
      expect.objectContaining({ filingState: "PA" }),
    );
    expect(transactionsCsvMock).toHaveBeenCalledWith(
      expect.objectContaining({ filingState: "PA" }),
    );
    expect(destinationsCsvMock).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      body: "transaction csv",
      headers: {
        "cache-control": "private, no-store",
        "content-disposition":
          'attachment; filename="remorseless-tax-pa-transactions-2026-01-01-to-2026-04-01.csv"',
        "x-content-type-options": "nosniff",
      },
      status: 200,
      type: "text/csv; charset=utf-8",
    });
  });

  it("fails closed when a domestic record has no state", async () => {
    buildFullTaxReportMock.mockResolvedValue(
      reportFixture({ unassignedDomesticRecords: 1 }),
    );
    const { res, state } = responseFixture();

    await GET(requestFixture(), res);

    expect(state).toMatchObject({
      body: expect.objectContaining({
        status: 409,
        title: "Tax export has unassigned records",
      }),
      status: 409,
      type: "application/problem+json",
    });
    expect(transactionsCsvMock).not.toHaveBeenCalled();
  });

  it("requires an explicit supported filing state", async () => {
    const { res, state } = responseFixture();

    await GET(
      requestFixture(
        "/admin/tax-records/export?format=transactions&start=2026-01-01&end=2026-04-01",
      ),
      res,
    );

    expect(state).toMatchObject({
      body: expect.objectContaining({
        status: 400,
        title: "Invalid tax export request",
      }),
      status: 400,
      type: "application/problem+json",
    });
    expect(buildFullTaxReportMock).not.toHaveBeenCalled();
  });
});
