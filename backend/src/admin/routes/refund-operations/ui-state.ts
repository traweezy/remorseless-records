import type {
  RefundCase,
  RefundCaseStatus,
  RefundProvider,
} from "../../../lib/refund-operations/types"

export type StatusFilter = "all" | RefundCaseStatus
export type ProviderFilter = "all" | RefundProvider

export const isStatusFilter = (value: string): value is StatusFilter =>
  value === "all" ||
  value === "action_required" ||
  value === "processing" ||
  value === "verified"

export const isProviderFilter = (value: string): value is ProviderFilter =>
  value === "all" ||
  value === "disabled" ||
  value === "stripe_tax" ||
  value === "taxrate_io" ||
  value === "untracked"

export const caseLabel = (refundCase: RefundCase): string =>
  refundCase.displayId === null
    ? "Checkout recovery"
    : `Order #${refundCase.displayId}`

export const filterRefundCases = ({
  cases,
  provider,
  search,
  status,
}: {
  cases: RefundCase[]
  provider: ProviderFilter
  search: string
  status: StatusFilter
}): RefundCase[] => {
  const query = search.trim().toLowerCase()
  return cases.filter((refundCase) => {
    const matchesStatus = status === "all" || refundCase.status === status
    const matchesProvider =
      provider === "all" || refundCase.provider === provider
    const matchesSearch =
      !query ||
      caseLabel(refundCase).toLowerCase().includes(query) ||
      refundCase.reasonLabels.some((reason) =>
        reason.toLowerCase().includes(query)
      )
    return matchesStatus && matchesProvider && matchesSearch
  })
}
