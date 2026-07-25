import type {
  ICartModuleService,
  ILockingModule,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

import {
  CART_RETENTION_JOB_LOCK,
  removeExpiredAnonymousCarts,
  resolveCartRetentionConfig,
} from "../lib/cart-retention";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export default async function removeExpiredAnonymousCartsJob(
  container: MedusaContainer,
) {
  const logger = container.resolve<Logger>("logger");

  try {
    const retentionConfig = resolveCartRetentionConfig();
    if (!retentionConfig.enabled) {
      logger.info(
        "Anonymous cart retention is disabled; no carts were inspected or changed",
      );
      return;
    }

    const cartService = container.resolve<ICartModuleService>(Modules.CART);
    const lockingService = container.resolve<ILockingModule>(Modules.LOCKING);
    const result = await lockingService.execute(
      CART_RETENTION_JOB_LOCK,
      () =>
        removeExpiredAnonymousCarts({
          cartService,
          lockingService,
          config: retentionConfig,
        }),
      { timeout: 5 },
    );
    logger.info(
      `Anonymous cart retention completed: ${JSON.stringify(result)}`,
    );
  } catch (error) {
    logger.error(`Anonymous cart retention failed: ${errorMessage(error)}`);
    throw error;
  }
}

export const config = {
  name: "remove-expired-anonymous-carts",
  schedule: "17 4 * * *",
};
