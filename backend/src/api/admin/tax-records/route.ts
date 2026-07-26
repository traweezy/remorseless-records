import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import {
  taxReportErrorName,
  taxReportProblem,
} from "../../../lib/tax-reporting/http";
import { parseTaxReportPeriod } from "../../../lib/tax-reporting/periods";
import {
  buildTaxReport,
  parseTaxReportFilters,
} from "../../../lib/tax-reporting/query";

const searchParamsFrom = (req: AuthenticatedMedusaRequest): URLSearchParams =>
  new URL(req.originalUrl, "http://medusa.local").searchParams;

const problemResponse = (
  res: MedusaResponse,
  error: unknown,
): MedusaResponse => {
  const problem = taxReportProblem({ error, operation: "report" });
  return res
    .status(problem.status)
    .type("application/problem+json")
    .json(problem.body);
};

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  try {
    const searchParams = searchParamsFrom(req);
    const period = parseTaxReportPeriod({
      endDate: searchParams.get("end"),
      startDate: searchParams.get("start"),
    });
    const filters = parseTaxReportFilters(searchParams);
    const report = await buildTaxReport({
      container: req.scope,
      filters,
      period,
    });
    res.status(200).json(report);
  } catch (error) {
    const problem = taxReportProblem({ error, operation: "report" });
    if (problem.status === 500) {
      const logger = req.scope.resolve("logger") as {
        error?: (message: string) => void;
      };
      logger.error?.(
        `[tax-records] Report generation failed (${taxReportErrorName(error)}).`,
      );
    }
    problemResponse(res, error);
  }
};
