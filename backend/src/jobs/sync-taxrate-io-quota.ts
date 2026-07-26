import type { Logger, MedusaContainer } from "@medusajs/framework/types";

import { syncTaxRateIoQuota } from "../lib/tax-control/quota";
import type TaxControlModuleService from "../modules/tax-control/service";

export default async function syncTaxRateIoQuotaJob(
  container: MedusaContainer,
): Promise<void> {
  const logger = container.resolve<Logger>("logger");
  const service = container.resolve<TaxControlModuleService>("tax_control");
  await syncTaxRateIoQuota({ logger, service });
}

export const config = {
  name: "sync-taxrate-io-quota",
  schedule: "*/5 * * * *",
};
