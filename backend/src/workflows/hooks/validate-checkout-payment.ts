import { completeCartWorkflow } from "@medusajs/core-flows";
import { MedusaError } from "@medusajs/framework/utils";

import {
  CheckoutPaymentValidationError,
  validateCheckoutPayment,
} from "../../lib/checkout/payment-validation";
import { recordOperationalIncident } from "../../lib/health/incidents";

completeCartWorkflow.hooks.validate(async ({ cart }) => {
  try {
    validateCheckoutPayment(cart);
  } catch (error: unknown) {
    if (error instanceof CheckoutPaymentValidationError) {
      try {
        await recordOperationalIncident("payment_tax_mismatch");
      } catch {
        // The validation remains fail-closed when incident persistence is down.
      }
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `${error.code}: ${error.message}`,
      );
    }
    throw error;
  }
});
