import { siteMetadata } from "@/config/site"

const formatAddress = (): string => {
  const address = siteMetadata.contact.address
  return [
    address.street,
    `${address.locality}, ${address.region} ${address.postalCode}`,
    address.country,
  ].join(", ")
}

export const LEGAL_EFFECTIVE_DATE = "February 8, 2026"

export const legalConfig = {
  businessName: siteMetadata.name,
  supportEmail: siteMetadata.contact.email,
  supportPhone: siteMetadata.contact.phone,
  mailingAddress: formatAddress(),
  governingLaw: "Arizona, United States",
  shipping: {
    processingWindow: "1-3 business days",
    domesticTransitWindow: "3-7 business days",
    internationalTransitWindow: "7-21 business days",
    preorders: "Preorders ship by the date listed on the product page.",
    backorders: "Backorders ship as inventory becomes available and may ship separately.",
    partialShipments:
      "Orders with mixed availability may ship in multiple packages at no additional shipping charge.",
  },
  returns: {
    windowDays: 30,
    refundTimeline: "5-10 business days after return acceptance",
    condition:
      "Items must be unused, unwashed, and in original packaging unless damaged in transit.",
    excludedItems: [
      "Final sale items",
      "Digital products",
      "Opened media where seal removal is required for playback",
      "Gift cards",
    ],
  },
  privacy: {
    retention: {
      orders: "7 years",
      support: "3 years",
      marketingSuppression: "5 years",
      privacyRequests: "3 years",
    },
    processors: ["Stripe", "shipping carriers", "email service providers"],
  },
} as const

export const legalRoutes = {
  terms: "/terms",
  privacy: "/privacy",
  shipping: "/shipping",
  returns: "/returns",
  accessibility: "/accessibility",
  cookies: "/cookies",
  contact: "/contact",
} as const

