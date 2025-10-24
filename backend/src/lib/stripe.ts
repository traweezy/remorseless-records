import Stripe from "stripe"
import { STRIPE_API_KEY } from "./constants"
import { assertValue } from "../utils/assert-value"

const stripeClient = new Stripe(
  assertValue(
    STRIPE_API_KEY,
    "STRIPE_API_KEY is not configured. Set it in your environment to enable Stripe Checkout."
  )
)

export const getStripeClient = (): Stripe => stripeClient
