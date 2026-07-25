import type { Metadata } from "next"

import { CheckoutRecovery } from "@/features/checkout/components/checkout-recovery"

export const metadata: Metadata = {
  title: "Confirming order",
  robots: {
    index: false,
    follow: false,
  },
}

const CheckoutRecoveryPage = () => <CheckoutRecovery />

export default CheckoutRecoveryPage
