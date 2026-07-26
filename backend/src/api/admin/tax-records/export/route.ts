import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { z } from "zod";

import {
  taxDestinationsCsv,
  taxTransactionsCsv,
} from "../../../../lib/tax-reporting/csv";
import { parseTaxReportPeriod } from "../../../../lib/tax-reporting/periods";
import { buildFullTaxReport } from "../../../../lib/tax-reporting/query";

const exportSchema = z.enum(["destinations", "transactions"]);

const invalidRequest = (
  res: MedusaResponse,
  error: unknown,
): MedusaResponse => {
  const detail =
    error instanceof z.ZodError
      ? error.issues[0]?.message
      : error instanceof Error
        ? error.message
        : null;
  return res
    .status(400)
    .type("application/problem+json")
    .json({
      detail: detail ?? "The tax export request is invalid.",
      status: 400,
      title: "Invalid tax export request",
      type: "https://remorselessrecords.com/problems/invalid-tax-export",
    });
};

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
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
            "The export reached its safety limit and would be incomplete. Narrow the reporting period.",
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
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).type("text/csv; charset=utf-8").send(csv);
  } catch (error) {
    invalidRequest(res, error);
  }
};
