import { z } from "zod";

import { TaxReportPeriodError } from "./periods";

export type TaxReportOperation = "export" | "report";

export type TaxReportProblem = {
  body: {
    detail: string;
    status: 400 | 500;
    title: string;
    type: string;
  };
  status: 400 | 500;
};

const operationLabel = (operation: TaxReportOperation): string =>
  operation === "export" ? "tax export" : "tax report";

export const taxReportErrorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

export const taxReportProblem = ({
  error,
  operation,
}: {
  error: unknown;
  operation: TaxReportOperation;
}): TaxReportProblem => {
  const validationDetail =
    error instanceof z.ZodError
      ? error.issues[0]?.message
      : error instanceof TaxReportPeriodError
        ? error.message
        : null;
  const label = operationLabel(operation);

  if (validationDetail) {
    return {
      body: {
        detail: validationDetail,
        status: 400,
        title: `Invalid ${label} request`,
        type: `https://remorselessrecords.com/problems/invalid-${label.replaceAll(
          " ",
          "-",
        )}`,
      },
      status: 400,
    };
  }

  return {
    body: {
      detail: `The ${label} could not be generated. Try again or review the server logs.`,
      status: 500,
      title: `${label.charAt(0).toUpperCase()}${label.slice(1)} unavailable`,
      type: `https://remorselessrecords.com/problems/${label.replaceAll(
        " ",
        "-",
      )}-unavailable`,
    },
    status: 500,
  };
};
