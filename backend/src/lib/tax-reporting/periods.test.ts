import {
  newYorkCalendarMonth,
  newYorkMidnightUtc,
  newYorkSalesTaxQuarter,
  newYorkSalesTaxYear,
  parseTaxReportPeriod,
} from "./periods";

describe("tax reporting periods", () => {
  it("uses New York midnight across daylight-saving transitions", () => {
    expect(newYorkMidnightUtc("2026-03-08")).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(newYorkMidnightUtc("2026-11-01")).toBe(
      "2026-11-01T04:00:00.000Z",
    );
  });

  it("builds the March through February sales-tax year", () => {
    expect(
      newYorkSalesTaxYear(new Date("2026-01-15T12:00:00.000Z")),
    ).toEqual({
      endDate: "2026-03-01",
      startDate: "2025-03-01",
    });
    expect(
      newYorkSalesTaxYear(new Date("2026-07-15T12:00:00.000Z"), -1),
    ).toEqual({
      endDate: "2026-03-01",
      startDate: "2025-03-01",
    });
  });

  it("builds current and previous calendar-month filing periods", () => {
    expect(
      newYorkCalendarMonth(new Date("2026-01-15T12:00:00.000Z")),
    ).toEqual({
      endDate: "2026-02-01",
      startDate: "2026-01-01",
    });
    expect(
      newYorkCalendarMonth(new Date("2026-01-15T12:00:00.000Z"), -1),
    ).toEqual({
      endDate: "2026-01-01",
      startDate: "2025-12-01",
    });
  });

  it("builds New York quarters including December through February", () => {
    expect(
      newYorkSalesTaxQuarter(new Date("2026-01-15T12:00:00.000Z")),
    ).toEqual({
      endDate: "2026-03-01",
      startDate: "2025-12-01",
    });
    expect(
      newYorkSalesTaxQuarter(new Date("2026-07-15T12:00:00.000Z"), -1),
    ).toEqual({
      endDate: "2026-06-01",
      startDate: "2026-03-01",
    });
  });

  it("returns end-exclusive UTC boundaries", () => {
    expect(
      parseTaxReportPeriod({
        endDate: "2027-03-01",
        startDate: "2026-03-01",
      }),
    ).toMatchObject({
      endExclusive: "2027-03-01T05:00:00.000Z",
      startInclusive: "2026-03-01T05:00:00.000Z",
      timeZone: "America/New_York",
    });
  });

  it("rejects reversed and overlong periods", () => {
    expect(() =>
      parseTaxReportPeriod({
        endDate: "2026-03-01",
        startDate: "2026-03-01",
      }),
    ).toThrow("after its start date");
    expect(() =>
      parseTaxReportPeriod({
        endDate: "2026-03-02",
        startDate: "2020-03-01",
      }),
    ).toThrow("limited");
  });
});
