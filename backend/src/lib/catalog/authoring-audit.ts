export const catalogAuthoringProductKinds = [
  "music_release",
  "merch",
  "fixed_bundle",
  "mystery_bundle",
] as const

export type CatalogAuthoringProductKind =
  (typeof catalogAuthoringProductKinds)[number]

export const catalogAuthoringAuditStatuses = [
  "classified",
  "needs_review",
  "conflict",
] as const

export type CatalogAuthoringAuditStatus =
  (typeof catalogAuthoringAuditStatuses)[number]

export type CatalogAuthoringAuditIssue = {
  code:
    | "bundle_profile_missing"
    | "catalog_product_type_inactive"
    | "catalog_product_type_missing"
    | "duplicate_bundle_profile"
    | "duplicate_catalog_profile"
    | "invalid_authoring_kind"
    | "kind_signal_conflict"
    | "native_product_type_missing"
    | "unrecognized_native_product_type"
    | "unrecognized_product_type"
  message: string
  severity: "info" | "warning" | "error"
}

export type CatalogAuthoringKindSignal = {
  kind: CatalogAuthoringProductKind
  source:
    | "authoring_metadata"
    | "bundle_profile"
    | "catalog_product_type"
    | "native_product_type"
  value: string
}

export type CatalogAuthoringAuditProduct = {
  handle: string | null
  id: string
  metadata?: Record<string, unknown> | null
  nativeProductType?: string | null
  status: string | null
  title: string
}

export type CatalogAuthoringAuditProfile = {
  productId: string
  productTypeId: string | null
}

export type CatalogAuthoringAuditReference = {
  id: string
  isActive: boolean
  kind: string
  label: string
  value: string
}

export type CatalogAuthoringAuditBundle = {
  bundleType: string
  productId: string
}

export type CatalogAuthoringAuditItem = {
  handle: string | null
  id: string
  issues: CatalogAuthoringAuditIssue[]
  kind: CatalogAuthoringProductKind | null
  signals: CatalogAuthoringKindSignal[]
  status: CatalogAuthoringAuditStatus
  title: string
}

export type CatalogAuthoringAuditSummary = {
  blockingItemCount: number
  byKind: Record<CatalogAuthoringProductKind, number>
  byStatus: Record<CatalogAuthoringAuditStatus, number>
  issueCounts: Record<string, number>
  total: number
}

export type CatalogAuthoringAuditReport = {
  items: CatalogAuthoringAuditItem[]
  summary: CatalogAuthoringAuditSummary
}

const normalizedKindAliases: Record<string, CatalogAuthoringProductKind> = {
  "fixed-bundle": "fixed_bundle",
  "fixed-bundles": "fixed_bundle",
  "fixed bundle": "fixed_bundle",
  fixed_bundle: "fixed_bundle",
  merch: "merch",
  merchandise: "merch",
  "music-release": "music_release",
  "music-releases": "music_release",
  "music release": "music_release",
  music_release: "music_release",
  "mystery-box": "mystery_bundle",
  "mystery-bundle": "mystery_bundle",
  "mystery box": "mystery_bundle",
  "mystery bundle": "mystery_bundle",
  mystery_bundle: "mystery_bundle",
}

const normalizeKindValue = (
  value: unknown,
): CatalogAuthoringProductKind | null => {
  if (typeof value !== "string") {
    return null
  }
  return normalizedKindAliases[value.trim().toLowerCase()] ?? null
}

const bundleKind = (value: string): CatalogAuthoringProductKind =>
  value.trim().toLowerCase() === "mystery"
    ? "mystery_bundle"
    : "fixed_bundle"

const groupByProductId = <T extends { productId: string }>(
  records: T[],
): Map<string, T[]> => {
  const grouped = new Map<string, T[]>()
  for (const record of records) {
    const current = grouped.get(record.productId) ?? []
    current.push(record)
    grouped.set(record.productId, current)
  }
  return grouped
}

const addIssue = (
  issues: CatalogAuthoringAuditIssue[],
  issue: CatalogAuthoringAuditIssue,
): void => {
  if (!issues.some(({ code }) => code === issue.code)) {
    issues.push(issue)
  }
}

const classifyProduct = ({
  bundles,
  product,
  profiles,
  referencesById,
}: {
  bundles: CatalogAuthoringAuditBundle[]
  product: CatalogAuthoringAuditProduct
  profiles: CatalogAuthoringAuditProfile[]
  referencesById: Map<string, CatalogAuthoringAuditReference>
}): CatalogAuthoringAuditItem => {
  const issues: CatalogAuthoringAuditIssue[] = []
  const signals: CatalogAuthoringKindSignal[] = []

  if (profiles.length > 1) {
    addIssue(issues, {
      code: "duplicate_catalog_profile",
      message: "More than one active catalog profile points to this product.",
      severity: "error",
    })
  }
  if (bundles.length > 1) {
    addIssue(issues, {
      code: "duplicate_bundle_profile",
      message: "More than one active bundle profile points to this product.",
      severity: "error",
    })
  }

  const metadataKindValue = product.metadata?.authoring_kind
  if (metadataKindValue !== undefined && metadataKindValue !== null) {
    const metadataKind = normalizeKindValue(metadataKindValue)
    if (metadataKind) {
      signals.push({
        kind: metadataKind,
        source: "authoring_metadata",
        value: String(metadataKindValue),
      })
    } else {
      addIssue(issues, {
        code: "invalid_authoring_kind",
        message: "The legacy authoring-kind metadata is not recognized.",
        severity: "warning",
      })
    }
  }

  const nativeProductType = product.nativeProductType?.trim() ?? ""
  if (!nativeProductType) {
    addIssue(issues, {
      code: "native_product_type_missing",
      message:
        "The product is classified by catalog data but still needs a native Medusa Product Type during cutover.",
      severity: "info",
    })
  } else {
    const nativeKind = normalizeKindValue(nativeProductType)
    if (nativeKind) {
      signals.push({
        kind: nativeKind,
        source: "native_product_type",
        value: nativeProductType,
      })
    } else {
      addIssue(issues, {
        code: "unrecognized_native_product_type",
        message: `Native Product Type "${nativeProductType}" is not mapped to an authoring kind.`,
        severity: "warning",
      })
    }
  }

  const profile = profiles.at(0)
  if (!profile?.productTypeId) {
    addIssue(issues, {
      code: "catalog_product_type_missing",
      message: "The catalog profile has no controlled Product Type.",
      severity: "warning",
    })
  } else {
    const reference = referencesById.get(profile.productTypeId)
    const referenceKind =
      reference?.kind === "product_type"
        ? normalizeKindValue(reference.value) ??
          normalizeKindValue(reference.label)
        : null
    if (reference && referenceKind) {
      signals.push({
        kind: referenceKind,
        source: "catalog_product_type",
        value: reference.value,
      })
      if (!reference.isActive) {
        addIssue(issues, {
          code: "catalog_product_type_inactive",
          message: `Catalog Product Type "${reference.label}" is archived.`,
          severity: "warning",
        })
      }
    } else {
      addIssue(issues, {
        code: "unrecognized_product_type",
        message:
          "The controlled catalog Product Type is missing or does not map to one of the four authoring kinds.",
        severity: "warning",
      })
    }
  }

  for (const bundle of bundles) {
    signals.push({
      kind: bundleKind(bundle.bundleType),
      source: "bundle_profile",
      value: bundle.bundleType,
    })
  }

  const kinds = [...new Set(signals.map(({ kind }) => kind))]
  if (kinds.length > 1) {
    addIssue(issues, {
      code: "kind_signal_conflict",
      message: `Classification sources disagree: ${kinds.join(", ")}.`,
      severity: "error",
    })
  }

  const kind = kinds.length === 1 ? kinds[0] ?? null : null
  if (
    (kind === "fixed_bundle" || kind === "mystery_bundle") &&
    bundles.length === 0
  ) {
    addIssue(issues, {
      code: "bundle_profile_missing",
      message: "The product is a bundle but has no active bundle profile.",
      severity: "warning",
    })
  }

  const status: CatalogAuthoringAuditStatus = issues.some(
    ({ severity }) => severity === "error",
  )
    ? "conflict"
    : kind === null ||
        issues.some(({ severity }) => severity === "warning")
      ? "needs_review"
      : "classified"

  return {
    handle: product.handle,
    id: product.id,
    issues,
    kind,
    signals,
    status,
    title: product.title,
  }
}

const emptyKindCounts = (): Record<CatalogAuthoringProductKind, number> => ({
  fixed_bundle: 0,
  merch: 0,
  music_release: 0,
  mystery_bundle: 0,
})

const emptyStatusCounts = (): Record<CatalogAuthoringAuditStatus, number> => ({
  classified: 0,
  conflict: 0,
  needs_review: 0,
})

export const buildCatalogAuthoringAudit = ({
  bundles,
  products,
  profiles,
  references,
}: {
  bundles: CatalogAuthoringAuditBundle[]
  products: CatalogAuthoringAuditProduct[]
  profiles: CatalogAuthoringAuditProfile[]
  references: CatalogAuthoringAuditReference[]
}): CatalogAuthoringAuditReport => {
  const bundlesByProductId = groupByProductId(bundles)
  const profilesByProductId = groupByProductId(profiles)
  const referencesById = new Map(
    references.map((reference) => [reference.id, reference]),
  )
  const items = products
    .map((product) =>
      classifyProduct({
        bundles: bundlesByProductId.get(product.id) ?? [],
        product,
        profiles: profilesByProductId.get(product.id) ?? [],
        referencesById,
      }),
    )
    .sort(
      (left, right) =>
        left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
    )
  const byKind = emptyKindCounts()
  const byStatus = emptyStatusCounts()
  const issueCounts: Record<string, number> = {}

  for (const item of items) {
    byStatus[item.status] += 1
    if (item.kind) {
      byKind[item.kind] += 1
    }
    for (const issue of item.issues) {
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1
    }
  }

  return {
    items,
    summary: {
      blockingItemCount: byStatus.conflict + byStatus.needs_review,
      byKind,
      byStatus,
      issueCounts,
      total: items.length,
    },
  }
}
