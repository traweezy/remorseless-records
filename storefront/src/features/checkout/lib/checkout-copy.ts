import type { StripeError } from "@stripe/stripe-js"

const DECLINE_MESSAGES: Record<string, string> = {
  insufficient_funds:
    "This payment method has insufficient funds. Try another method.",
  expired_card: "This card has expired. Check the details or use another card.",
  incorrect_cvc: "The security code is incorrect. Check it and try again.",
  incorrect_number: "The card number is incorrect. Check it and try again.",
  card_velocity_exceeded:
    "This payment method cannot be used right now. Try another method.",
}

export const safeStripeErrorMessage = (
  error: Pick<StripeError, "code" | "decline_code" | "type">
): string => {
  const declineCode = error.decline_code ?? ""
  if (declineCode in DECLINE_MESSAGES) {
    return DECLINE_MESSAGES[declineCode]!
  }

  switch (error.code) {
    case "incomplete_number":
      return "Enter a complete card number."
    case "incomplete_expiry":
      return "Enter the card expiration date."
    case "incomplete_cvc":
      return "Enter the card security code."
    case "incomplete_zip":
      return "Enter the billing ZIP code."
    case "invalid_number":
      return "The card number is not valid. Check it and try again."
    case "invalid_expiry_month":
    case "invalid_expiry_year":
    case "invalid_expiry_year_past":
      return "The card expiration date is not valid."
    case "invalid_cvc":
      return "The card security code is not valid."
    case "card_declined":
      return "The payment was declined. Try another payment method."
    case "payment_intent_authentication_failure":
      return "Authentication was not completed. Try again or use another method."
  }

  if (error.type === "api_connection_error" || error.type === "api_error") {
    return "We could not confirm the result. Do not pay again while we check your order."
  }

  return "Payment could not be completed. Check the details or try another method."
}

export const stripeResultNeedsReconciliation = (
  error: Pick<StripeError, "type">
): boolean =>
  error.type === "api_connection_error" || error.type === "api_error"
