import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { z } from "zod";

import { parseTaxReportPeriod } from "../../../lib/tax-reporting/periods";
import {
  buildTaxReport,
  parseTaxReportFilters,
} from "../../../lib/tax-reporting/query";

const searchParamsFrom = (req: AuthenticatedMedusaRequest): URLSearchParams =>
  new URL(req.originalUrl, "http://medusa.local").searchParams;

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
      detail: detail ?? "The tax report request is invalid.",
      status: 400,
      title: "Invalid tax report request",
      type: "https://remorselessrecords.com/problems/invalid-tax-report",
    });
};

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
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
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).json(report);
  } catch (error) {
    invalidRequest(res, error);
  }
};
