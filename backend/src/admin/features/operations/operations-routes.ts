export type OperationsWorkspace =
  | "overview"
  | "tax-records"
  | "refunds"
  | "media-cleanup"

export type OperationsDetailWorkspace = Exclude<
  OperationsWorkspace,
  "overview"
>

export const operationsRoutePaths = {
  "media-cleanup": "/operations/media-cleanup",
  overview: "/operations",
  refunds: "/operations/refunds",
  "tax-records": "/operations/tax-records",
} as const satisfies Record<OperationsWorkspace, string>

export const operationsAppRoutePaths = {
  "media-cleanup": "/app/operations/media-cleanup",
  refunds: "/app/operations/refunds",
  "tax-records": "/app/operations/tax-records",
} as const satisfies Record<OperationsDetailWorkspace, string>

export const taxControlRoutePath = "/settings/tax-control"
export const taxControlAppRoutePath = `/app${taxControlRoutePath}`

export type ReplaceAdminLocation = {
  replace: (url: string) => void
}

export const replaceLegacyOperationsLocation = (
  location: ReplaceAdminLocation,
  workspace: OperationsDetailWorkspace,
): void => {
  location.replace(operationsAppRoutePaths[workspace])
}

export const replaceLegacyTaxControlLocation = (
  location: ReplaceAdminLocation,
): void => {
  location.replace(taxControlAppRoutePath)
}
