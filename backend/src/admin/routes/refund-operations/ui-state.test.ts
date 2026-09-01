import type { RefundCase } from "../../../lib/refund-operations/types"
import {
  caseLabel,
  filterRefundCases,
  isProviderFilter,
  isStatusFilter,
} from "./ui-state"

const refundCase = ({
  displayId,
  provider,
  reasonLabels,
  status,
}: Pick<
  RefundCase,
  "displayId" | "provider" | "reasonLabels" | "status"
>): RefundCase => ({
  caseId: `case-${displayId ?? "checkout"}`,
  currencyCode: "usd",
  displayId,
  latestRefundAt: null,
  lastVerifiedAt: null,
  medusaRefundAmountMinor: 500,
  medusaRefundCount: 1,
  nextAction: "No action required.",
  orderId: displayId === null ? null : `order_${displayId}`,
  provider,
  reasonLabels,
  status,
  stripeRefundAmountMinor: 500,
  stripeRefundCount: 1,
  stripeStatuses: ["succeeded"],
  taxStatus:
    provider === "stripe_tax"
      ? "verified"
      : provider === "disabled"
        ? "not_collected"
        : "not_applicable",
})

const cases = [
  refundCase({
    displayId: 42,
    provider: "stripe_tax",
    reasonLabels: ["Pricing error"],
    status: "action_required",
  }),
  refundCase({
    displayId: 43,
    provider: "taxrate_io",
    reasonLabels: ["Customer care"],
    status: "verified",
  }),
  refundCase({
    displayId: null,
    provider: "taxrate_io",
    reasonLabels: [],
    status: "processing",
  }),
  refundCase({
    displayId: 44,
    provider: "disabled",
    reasonLabels: ["Tax collection off"],
    status: "verified",
  }),
]

describe("refund operations UI state", () => {
  it("applies search, status, and provider filters in conjunction", () => {
    expect(
      filterRefundCases({
        cases,
        provider: "stripe_tax",
        search: "pricing",
        status: "action_required",
      })
    ).toEqual([cases[0]])
    expect(
      filterRefundCases({
        cases,
        provider: "stripe_tax",
        search: "pricing",
        status: "verified",
      })
    ).toEqual([])
  })

  it("searches order number, reason, and checkout-recovery label", () => {
    expect(
      filterRefundCases({
        cases,
        provider: "all",
        search: "43",
        status: "all",
      })
    ).toEqual([cases[1]])
    expect(
      filterRefundCases({
        cases,
        provider: "all",
        search: "customer care",
        status: "all",
      })
    ).toEqual([cases[1]])
    expect(
      filterRefundCases({
        cases,
        provider: "all",
        search: "checkout recovery",
        status: "all",
      })
    ).toEqual([cases[2]])
  })

  it("rejects unknown select values at the UI boundary", () => {
    expect(isStatusFilter("processing")).toBe(true)
    expect(isStatusFilter("refunded")).toBe(false)
    expect(isProviderFilter("stripe_tax")).toBe(true)
    expect(isProviderFilter("disabled")).toBe(true)
    expect(isProviderFilter("stripe")).toBe(false)
  })

  it("filters explicit tax-disabled cases separately from untracked evidence", () => {
    expect(
      filterRefundCases({
        cases,
        provider: "disabled",
        search: "",
        status: "all",
      })
    ).toEqual([cases[3]])
  })

  it("uses an explicit label when no order was created", () => {
    expect(caseLabel(cases[2]!)).toBe("Checkout recovery")
  })
})
