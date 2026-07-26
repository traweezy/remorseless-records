import { z } from "zod";

export const TAX_REPORT_TIME_ZONE = "America/New_York";
export const TAX_REPORT_MAX_DAYS = 1_462;

export class TaxReportPeriodError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxReportPeriodError";
  }
}

export type TaxReportPeriod = {
  endDate: string;
  endExclusive: string;
  label: string;
  startDate: string;
  startInclusive: string;
  timeZone: typeof TAX_REPORT_TIME_ZONE;
};

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year!, month! - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day
    );
  }, "Date must be a real calendar date.");

const dateParts = (value: string): [number, number, number] => {
  const [year, month, day] = value.split("-").map(Number);
  return [year!, month!, day!];
};

const utcDate = (value: string): Date => {
  const [year, month, day] = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day));
};

const dateOnly = (value: Date): string => value.toISOString().slice(0, 10);

const addDays = (value: string, days: number): string => {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateOnly(date);
};

const timeZoneOffsetMilliseconds = (instant: Date): number => {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: TAX_REPORT_TIME_ZONE,
    year: "numeric",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const hour = values.hour === 24 ? 0 : values.hour!;
  return (
    Date.UTC(
      values.year!,
      values.month! - 1,
      values.day!,
      hour,
      values.minute!,
      values.second!,
    ) - instant.getTime()
  );
};

export const newYorkMidnightUtc = (value: string): string => {
  const parsed = dateSchema.parse(value);
  const [year, month, day] = dateParts(parsed);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  const offset = timeZoneOffsetMilliseconds(utcMidnight);
  return new Date(utcMidnight.getTime() - offset).toISOString();
};

const periodLabel = (startDate: string, endDate: string): string => {
  const format = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  });
  return `${format.format(utcDate(startDate))} – ${format.format(
    utcDate(addDays(endDate, -1)),
  )}`;
};

export const parseTaxReportPeriod = ({
  endDate,
  startDate,
}: {
  endDate: unknown;
  startDate: unknown;
}): TaxReportPeriod => {
  const start = dateSchema.parse(startDate);
  const end = dateSchema.parse(endDate);
  const startUtc = utcDate(start);
  const endUtc = utcDate(end);
  const durationDays =
    (endUtc.getTime() - startUtc.getTime()) / (24 * 60 * 60 * 1000);

  if (durationDays <= 0) {
    throw new TaxReportPeriodError(
      "The report end date must be after its start date.",
    );
  }
  if (durationDays > TAX_REPORT_MAX_DAYS) {
    throw new TaxReportPeriodError(
      `Tax reports are limited to ${TAX_REPORT_MAX_DAYS} days at a time.`,
    );
  }

  return {
    endDate: end,
    endExclusive: newYorkMidnightUtc(end),
    label: periodLabel(start, end),
    startDate: start,
    startInclusive: newYorkMidnightUtc(start),
    timeZone: TAX_REPORT_TIME_ZONE,
  };
};

export const newYorkCalendarMonth = (
  reference = new Date(),
  offset = 0,
): { endDate: string; startDate: string } => {
  const local = new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: TAX_REPORT_TIME_ZONE,
    year: "numeric",
  }).formatToParts(reference);
  const year = Number(local.find((part) => part.type === "year")?.value);
  const month = Number(local.find((part) => part.type === "month")?.value);
  const monthIndex = year * 12 + month - 1 + offset;
  const startYear = Math.floor(monthIndex / 12);
  const startMonth = ((monthIndex % 12) + 12) % 12;
  const endMonthIndex = monthIndex + 1;
  const endYear = Math.floor(endMonthIndex / 12);
  const endMonth = ((endMonthIndex % 12) + 12) % 12;

  return {
    endDate: `${endYear}-${String(endMonth + 1).padStart(2, "0")}-01`,
    startDate: `${startYear}-${String(startMonth + 1).padStart(2, "0")}-01`,
  };
};

export const newYorkSalesTaxYear = (
  reference = new Date(),
  offset = 0,
): { endDate: string; startDate: string } => {
  const local = new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: TAX_REPORT_TIME_ZONE,
    year: "numeric",
  }).formatToParts(reference);
  const year = Number(local.find((part) => part.type === "year")?.value);
  const month = Number(local.find((part) => part.type === "month")?.value);
  const startYear = (month >= 3 ? year : year - 1) + offset;
  return {
    endDate: `${startYear + 1}-03-01`,
    startDate: `${startYear}-03-01`,
  };
};

export const newYorkSalesTaxQuarter = (
  reference = new Date(),
  offset = 0,
): { endDate: string; startDate: string } => {
  const localParts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TAX_REPORT_TIME_ZONE,
    year: "numeric",
  }).formatToParts(reference);
  const year = Number(
    localParts.find((part) => part.type === "year")?.value,
  );
  const month = Number(
    localParts.find((part) => part.type === "month")?.value,
  );
  const salesTaxYear = month >= 3 ? year : year - 1;
  const quarter =
    month >= 12 || month < 3 ? 3 : Math.floor((month - 3) / 3);
  const currentQuarterIndex = salesTaxYear * 4 + quarter;
  const quarterIndex = currentQuarterIndex + offset;
  const indexedSalesTaxYear = Math.floor(quarterIndex / 4);
  const indexedQuarter = ((quarterIndex % 4) + 4) % 4;
  const startMonth = 3 + indexedQuarter * 3;
  const normalizedStartYear =
    startMonth > 12 ? indexedSalesTaxYear + 1 : indexedSalesTaxYear;
  const normalizedStartMonth = startMonth > 12 ? startMonth - 12 : startMonth;
  const endMonthValue = normalizedStartMonth + 3;
  const endYear =
    endMonthValue > 12 ? normalizedStartYear + 1 : normalizedStartYear;
  const endMonth = endMonthValue > 12 ? endMonthValue - 12 : endMonthValue;

  return {
    endDate: `${endYear}-${String(endMonth).padStart(2, "0")}-01`,
    startDate: `${normalizedStartYear}-${String(normalizedStartMonth).padStart(
      2,
      "0",
    )}-01`,
  };
};
