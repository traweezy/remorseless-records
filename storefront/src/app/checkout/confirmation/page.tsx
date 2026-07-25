import type { Metadata } from "next"

import { CheckoutConfirmation } from "@/features/checkout/components/checkout-confirmation"

export const metadata: Metadata = {
  title: "Order confirmed",
  robots: {
    index: false,
    follow: false,
  },
}

const CheckoutConfirmationPage = () => <CheckoutConfirmation />

export default CheckoutConfirmationPage
