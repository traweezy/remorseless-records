import { completeCartWorkflow } from "@medusajs/core-flows";
import { MedusaError } from "@medusajs/framework/utils";

import {
  CheckoutPaymentValidationError,
  validateCheckoutPayment,
} from "../../lib/checkout/payment-validation";

completeCartWorkflow.hooks.validate(async ({ cart }) => {
  try {
    validateCheckoutPayment(cart);
  } catch (error: unknown) {
    if (error instanceof CheckoutPaymentValidationError) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `${error.code}: ${error.message}`,
      );
    }
    throw error;
  }
});
