import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { z } from "zod";

import {
  taxDestinationsCsv,
  taxTransactionsCsv,
} from "../../../../lib/tax-reporting/csv";
import {
  taxReportErrorName,
  taxReportProblem,
} from "../../../../lib/tax-reporting/http";
import { parseTaxReportPeriod } from "../../../../lib/tax-reporting/periods";
import { buildFullTaxReport } from "../../../../lib/tax-reporting/query";

const exportSchema = z.enum(["destinations", "transactions"]);

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
    const report = await buildFullTaxReport({
      container: req.scope,
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

    const csv =
      format === "transactions"
        ? taxTransactionsCsv(report)
        : taxDestinationsCsv(report);
    const filename = `remorseless-tax-${format}-${period.startDate}-to-${period.endDate}.csv`;
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
