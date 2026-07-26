import { z } from "zod";

import type { TaxFilingState } from "./filing-states";

export const TAX_REPORT_TIME_ZONE = "America/New_York";
export const TAX_REPORT_MAX_DAYS = 1_462;

export type TaxPeriodPreset =
  | "current-half-year"
  | "current-month"
  | "current-quarter"
  | "current-year"
  | "custom"
  | "previous-half-year"
  | "previous-month"
  | "previous-quarter"
  | "previous-year";

export type TaxPeriodPresetOption = {
  label: string;
  value: TaxPeriodPreset;
};

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

export const easternMidnightUtc = (value: string): string => {
  const parsed = dateSchema.parse(value);
  const [year, month, day] = dateParts(parsed);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day));
  const offset = timeZoneOffsetMilliseconds(utcMidnight);
  return new Date(utcMidnight.getTime() - offset).toISOString();
};

export const newYorkMidnightUtc = easternMidnightUtc;

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
    endExclusive: easternMidnightUtc(end),
    label: periodLabel(start, end),
    startDate: start,
    startInclusive: easternMidnightUtc(start),
    timeZone: TAX_REPORT_TIME_ZONE,
  };
};

const localYearMonth = (
  reference: Date,
): { month: number; year: number } => {
  const local = new Intl.DateTimeFormat("en-CA", {
    month: "2-digit",
    timeZone: TAX_REPORT_TIME_ZONE,
    year: "numeric",
  }).formatToParts(reference);
  return {
    month: Number(local.find((part) => part.type === "month")?.value),
    year: Number(local.find((part) => part.type === "year")?.value),
  };
};

const indexedMonthPeriod = ({
  monthIndex,
  months,
}: {
  monthIndex: number;
  months: number;
}): { endDate: string; startDate: string } => {
  const startYear = Math.floor(monthIndex / 12);
  const startMonth = ((monthIndex % 12) + 12) % 12;
  const endMonthIndex = monthIndex + months;
  const endYear = Math.floor(endMonthIndex / 12);
  const endMonth = ((endMonthIndex % 12) + 12) % 12;
  return {
    endDate: `${endYear}-${String(endMonth + 1).padStart(2, "0")}-01`,
    startDate: `${startYear}-${String(startMonth + 1).padStart(2, "0")}-01`,
  };
};

export const easternCalendarMonth = (
  reference = new Date(),
  offset = 0,
): { endDate: string; startDate: string } => {
  const { month, year } = localYearMonth(reference);
  const monthIndex = year * 12 + month - 1 + offset;
  return indexedMonthPeriod({ monthIndex, months: 1 });
};

export const newYorkCalendarMonth = easternCalendarMonth;

export const easternCalendarQuarter = (
  reference = new Date(),
  offset = 0,
): { endDate: string; startDate: string } => {
  const { month, year } = localYearMonth(reference);
  const currentMonthIndex = year * 12 + month - 1;
  const monthIndex =
    Math.floor(currentMonthIndex / 3) * 3 + offset * 3;
  return indexedMonthPeriod({ monthIndex, months: 3 });
};

export const easternCalendarYear = (
  reference = new Date(),
  offset = 0,
): { endDate: string; startDate: string } => {
  const { year } = localYearMonth(reference);
  return indexedMonthPeriod({
    monthIndex: (year + offset) * 12,
    months: 12,
  });
};

export const easternCalendarHalfYear = (
  reference = new Date(),
  offset = 0,
): { endDate: string; startDate: string } => {
  const { month, year } = localYearMonth(reference);
  const currentHalfYearIndex = year * 2 + (month > 6 ? 1 : 0);
  const halfYearIndex = currentHalfYearIndex + offset;
  const indexedYear = Math.floor(halfYearIndex / 2);
  const indexedHalf = ((halfYearIndex % 2) + 2) % 2;
  return indexedMonthPeriod({
    monthIndex: indexedYear * 12 + indexedHalf * 6,
    months: 6,
  });
};

export const newYorkSalesTaxYear = (
  reference = new Date(),
  offset = 0,
): { endDate: string; startDate: string } => {
  const { month, year } = localYearMonth(reference);
  const startYear = (month >= 3 ? year : year - 1) + offset;
  return {
    endDate: `${startYear + 1}-03-01`,
    startDate: `${startYear}-03-01`,
  };
};

const commonPeriodOptions = ({
  quarterLabel,
}: {
  quarterLabel: string;
}): TaxPeriodPresetOption[] => [
  { label: "Current calendar month", value: "current-month" },
  { label: "Previous calendar month", value: "previous-month" },
  { label: `Current ${quarterLabel}`, value: "current-quarter" },
  { label: `Previous ${quarterLabel}`, value: "previous-quarter" },
];

export const taxPeriodPresetOptions = (
  filingState: TaxFilingState,
): TaxPeriodPresetOption[] => {
  if (filingState === "NY") {
    return [
      ...commonPeriodOptions({ quarterLabel: "NY sales-tax quarter" }),
      { label: "Current NY sales-tax year", value: "current-year" },
      { label: "Previous NY sales-tax year", value: "previous-year" },
      { label: "Custom dates", value: "custom" },
    ];
  }
  if (filingState === "PA") {
    return [
      ...commonPeriodOptions({ quarterLabel: "calendar quarter" }),
      { label: "Current PA half-year", value: "current-half-year" },
      { label: "Previous PA half-year", value: "previous-half-year" },
      { label: "Custom dates", value: "custom" },
    ];
  }
  return [
    ...commonPeriodOptions({ quarterLabel: "calendar quarter" }),
    { label: "Current calendar year", value: "current-year" },
    { label: "Previous calendar year", value: "previous-year" },
    { label: "Custom dates", value: "custom" },
  ];
};

export const taxPeriodForPreset = ({
  filingState,
  preset,
  reference = new Date(),
}: {
  filingState: TaxFilingState;
  preset: TaxPeriodPreset;
  reference?: Date;
}): { endDate: string; startDate: string } => {
  if (preset === "custom") {
    throw new TaxReportPeriodError(
      "Custom tax-report periods require explicit start and end dates.",
    );
  }
  const offset = preset.startsWith("previous-") ? -1 : 0;
  if (preset.endsWith("-month")) {
    return easternCalendarMonth(reference, offset);
  }
  if (preset.endsWith("-quarter")) {
    return filingState === "NY"
      ? newYorkSalesTaxQuarter(reference, offset)
      : easternCalendarQuarter(reference, offset);
  }
  if (preset.endsWith("-half-year")) {
    if (filingState !== "PA") {
      throw new TaxReportPeriodError(
        "Half-year presets are available only for Pennsylvania filing.",
      );
    }
    return easternCalendarHalfYear(reference, offset);
  }
  if (filingState === "PA") {
    throw new TaxReportPeriodError(
      "Pennsylvania filing presets use half-year rather than annual periods.",
    );
  }
  return filingState === "NY"
    ? newYorkSalesTaxYear(reference, offset)
    : easternCalendarYear(reference, offset);
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
