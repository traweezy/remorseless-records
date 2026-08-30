import type { TaxRecordDestination } from "./types"

export const TAX_FILING_STATES = ["CT", "NY", "PA"] as const

export type TaxFilingState = (typeof TAX_FILING_STATES)[number]
export type TaxFilingScope = "ALL" | TaxFilingState

export type TaxFilingProfile = {
  destinationGuidance: string
  dueDateGuidance: string
  filingFrequencyGuidance: string
  name: string
  portalName: string
  portalUrl: string
  returnName: string
  separateReconciliation: string
}

export const TAX_FILING_PROFILES = {
  CT: {
    destinationGuidance:
      "Connecticut has no local sales tax. Reconcile statewide totals and any special-rate rows before completing the return.",
    dueDateGuidance:
      "Form OS-114 is generally due by the last day of the month after the assigned filing period. Confirm the exact obligation in myconneCT.",
    filingFrequencyGuidance:
      "Connecticut DRS assigns monthly, calendar-quarterly, or calendar-annual filing.",
    name: "Connecticut",
    portalName: "myconneCT",
    portalUrl: "https://myconne.ct.gov/",
    returnName: "Form OS-114",
    separateReconciliation:
      "Add business-use tax, exemption support, special-rate lines, marketplace statements, and adjustments that are not represented by storefront orders.",
  },
  NY: {
    destinationGuidance:
      "New York is destination-based and requires local-jurisdiction reporting. Confirm the delivery jurisdiction and the applicable return schedules.",
    dueDateGuidance:
      "New York sales-tax returns are generally due within 20 days after the period ends. Confirm the exact obligation in Online Services.",
    filingFrequencyGuidance:
      "New York assigns part-quarterly, March–February quarterly, or March–February annual filing.",
    name: "New York",
    portalName: "New York Online Services",
    portalUrl: "https://www.tax.ny.gov/online/bus.htm",
    returnName: "Forms ST-809, ST-100, or ST-101",
    separateReconciliation:
      "Add use tax, exemption support, marketplace statements, bad-debt adjustments, and schedule lines that are not represented by storefront orders.",
  },
  PA: {
    destinationGuidance:
      "Pennsylvania requires state totals plus separate Philadelphia and Allegheny local amounts when applicable. Verify every locality bucket before filing.",
    dueDateGuidance:
      "Pennsylvania sales-tax returns are generally due on the 20th after the assigned period. Confirm the current REV-819 schedule and myPATH obligation.",
    filingFrequencyGuidance:
      "Pennsylvania assigns monthly, calendar-quarterly, or calendar-semiannual filing; high-liability accounts can also have accelerated prepayments.",
    name: "Pennsylvania",
    portalName: "myPATH",
    portalUrl: "https://mypath.pa.gov/",
    returnName: "PA-3",
    separateReconciliation:
      "Add business-use tax, credits, E-911 or other special fees, marketplace statements, and adjustments that are not represented by storefront orders.",
  },
} as const satisfies Record<TaxFilingState, TaxFilingProfile>

const normalizedEvidence = (destination: TaxRecordDestination): string =>
  [
    destination.county,
    destination.city,
    destination.jurisdictionName,
    destination.postalCode,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase()

export const filingBucketFor = ({
  destination,
  filingState,
}: {
  destination: TaxRecordDestination
  filingState: TaxFilingScope
}): string => {
  if (filingState === "CT") {
    return "Connecticut statewide"
  }
  if (filingState === "NY") {
    return (
      destination.jurisdictionName ??
      destination.county ??
      (destination.city && destination.postalCode
        ? `${destination.city} ${destination.postalCode} — verify locality`
        : "New York locality — verify")
    )
  }
  if (filingState === "PA") {
    const evidence = normalizedEvidence(destination)
    if (evidence.includes("philadelphia")) {
      return "Philadelphia local"
    }
    if (evidence.includes("allegheny")) {
      return "Allegheny local"
    }
    if (
      destination.county ||
      destination.jurisdictionName?.toLowerCase().includes("county")
    ) {
      return "Pennsylvania state only"
    }
    return "Pennsylvania locality — verify"
  }
  return destination.stateCode
    ? `${destination.stateCode} destination`
    : "Destination state — verify"
}

export const filingStateName = (scope: TaxFilingScope): string =>
  scope === "ALL" ? "All destinations" : TAX_FILING_PROFILES[scope].name
