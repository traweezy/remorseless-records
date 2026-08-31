export type DiscographyProjectionPayload = {
  product_id: string
  version: number
} & Record<string, unknown>

export type ExistingDiscographyProjectionRecord = {
  archived_at?: Date | string | null
  id: string
  product_id?: string | null
  source_mode?: string | null
  version: number
}

export type DiscographyProjectionSyncPlan = {
  archives: Array<{ archived_at: Date; id: string; version: number }>
  creates: DiscographyProjectionPayload[]
  retainedManual: number
  updates: Array<DiscographyProjectionPayload & { id: string }>
}

const assertVersionCanAdvance = (version: number): void => {
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    version >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("Discography projection state has an invalid version.")
  }
}

export const planDiscographyProjectionSync = (
  projected: DiscographyProjectionPayload[],
  existing: ExistingDiscographyProjectionRecord[],
  archivedAt: Date
): DiscographyProjectionSyncPlan => {
  if (Number.isNaN(archivedAt.getTime())) {
    throw new Error("Discography projection archive time is invalid.")
  }
  const existingIds = new Set<string>()
  for (const entry of existing) {
    if (!entry.id || existingIds.has(entry.id)) {
      throw new Error(
        "Discography projection state contains duplicate identities."
      )
    }
    existingIds.add(entry.id)
    assertVersionCanAdvance(entry.version)
  }
  const linked = existing.filter(
    (
      entry
    ): entry is ExistingDiscographyProjectionRecord & { product_id: string } =>
      entry.source_mode === "catalog_product" && Boolean(entry.product_id)
  )
  const linkedByProductId = new Map<string, (typeof linked)[number]>()
  for (const entry of linked) {
    if (linkedByProductId.has(entry.product_id)) {
      throw new Error(
        "Discography projection state contains duplicate Product links."
      )
    }
    linkedByProductId.set(entry.product_id, entry)
  }
  const projectedProductIds = new Set<string>()
  for (const entry of projected) {
    if (!entry.product_id || projectedProductIds.has(entry.product_id)) {
      throw new Error(
        "Discography projection contains duplicate or invalid Product links."
      )
    }
    assertVersionCanAdvance(entry.version)
    projectedProductIds.add(entry.product_id)
  }
  const creates: DiscographyProjectionPayload[] = []
  const updates: Array<DiscographyProjectionPayload & { id: string }> = []

  for (const entry of projected) {
    const current = linkedByProductId.get(entry.product_id)
    if (!current) {
      creates.push(entry)
      continue
    }
    updates.push({
      ...entry,
      id: current.id,
      version: current.version + 1,
    })
  }

  const archives = linked.flatMap((entry) =>
    !projectedProductIds.has(entry.product_id) && !entry.archived_at
      ? [
          {
            archived_at: archivedAt,
            id: entry.id,
            version: entry.version + 1,
          },
        ]
      : []
  )

  return {
    archives,
    creates,
    retainedManual: existing.length - linked.length,
    updates,
  }
}
