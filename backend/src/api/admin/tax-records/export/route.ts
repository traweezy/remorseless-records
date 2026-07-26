import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { z } from "zod";

import {
  taxDestinationsCsv,
  taxTransactionsCsv,
} from "../../../../lib/tax-reporting/csv";
import { TAX_FILING_STATES } from "../../../../lib/tax-reporting/filing-states";
import {
  taxReportErrorName,
  taxReportProblem,
} from "../../../../lib/tax-reporting/http";
import { parseTaxReportPeriod } from "../../../../lib/tax-reporting/periods";
import { buildFullTaxReport } from "../../../../lib/tax-reporting/query";

const exportSchema = z.enum(["destinations", "transactions"]);
const filingStateSchema = z.enum(TAX_FILING_STATES);

const problemResponse = (
  res: MedusaResponse,
  error: unknown,
): MedusaResponse => {
  const problem = taxReportProblem({ error, operation: "export" });
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
    const searchParams = new URL(
      req.originalUrl,
      "http://medusa.local",
    ).searchParams;
    const format = exportSchema.parse(searchParams.get("format"));
    const period = parseTaxReportPeriod({
      endDate: searchParams.get("end"),
      startDate: searchParams.get("start"),
    });
    const filingState = filingStateSchema.parse(
      searchParams.get("filing_state"),
    );
    const report = await buildFullTaxReport({
      container: req.scope,
      filingState,
      period,
    });
    if (report.source.truncated) {
      res
        .status(409)
        .type("application/problem+json")
        .json({
          detail:
            "The export reached its bounded source-scan limit and would be incomplete. Use an earlier period end or contact an engineer before filing.",
          status: 409,
          title: "Tax export is incomplete",
          type: "https://remorselessrecords.com/problems/tax-export-truncated",
        });
      return;
    }
    if (report.source.unassignedStateRecords > 0) {
      res
        .status(409)
        .type("application/problem+json")
        .json({
          detail:
            "At least one United States or country-unknown tax record has no destination state. Correct the source address before relying on a state filing export.",
          status: 409,
          title: "Tax export has unassigned records",
          type: "https://remorselessrecords.com/problems/tax-export-unassigned-state",
        });
      return;
    }

    const csv =
      format === "transactions"
        ? taxTransactionsCsv(report)
        : taxDestinationsCsv(report);
    const filename =
      `remorseless-tax-${filingState.toLowerCase()}-${format}-` +
      `${period.startDate}-to-${period.endDate}.csv`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).type("text/csv; charset=utf-8").send(csv);
  } catch (error) {
    const problem = taxReportProblem({ error, operation: "export" });
    if (problem.status === 500) {
      const logger = req.scope.resolve("logger") as {
        error?: (message: string) => void;
      };
      logger.error?.(
        `[tax-records] Export generation failed (${taxReportErrorName(error)}).`,
      );
    }
    problemResponse(res, error);
  }
};
