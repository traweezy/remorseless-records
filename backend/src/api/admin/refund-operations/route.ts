import type {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import type { Logger } from "@medusajs/framework/types";

import { buildRefundOperationsSnapshot } from "../../../lib/refund-operations/query";

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse,
): Promise<void> => {
  const startedAt = Date.now();
  const snapshot = await buildRefundOperationsSnapshot({
    container: req.scope,
  });
  const durationMs = Date.now() - startedAt;
  const logger = req.scope.resolve<Logger>("logger");
  logger.info(
    `[refund-operations] projected ${snapshot.summary.totalCases} cases (${snapshot.summary.actionRequired} action required) from ${snapshot.source.ordersScanned} orders and ${snapshot.source.evidenceScanned} evidence records in ${durationMs}ms`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Server-Timing", `refund-audit;dur=${durationMs}`);
  res.status(200).json(snapshot);
};
