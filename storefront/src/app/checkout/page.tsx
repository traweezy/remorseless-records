import type { Metadata } from "next"

import { CheckoutShell } from "@/features/checkout/components/checkout-shell"

export const metadata: Metadata = {
  title: "Checkout",
  description: "Securely complete your Remorseless Records order.",
  robots: {
    index: false,
    follow: false,
  },
}

const CheckoutPage = () => <CheckoutShell />

export default CheckoutPage
