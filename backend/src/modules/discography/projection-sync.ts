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

export const planDiscographyProjectionSync = (
  projected: DiscographyProjectionPayload[],
  existing: ExistingDiscographyProjectionRecord[],
  archivedAt: Date
): DiscographyProjectionSyncPlan => {
  const linked = existing.filter(
    (
      entry
    ): entry is ExistingDiscographyProjectionRecord & { product_id: string } =>
      entry.source_mode === "catalog_product" && Boolean(entry.product_id)
  )
  const linkedByProductId = new Map(
    linked.map((entry) => [entry.product_id, entry])
  )
  const projectedProductIds = new Set(
    projected.map((entry) => entry.product_id)
  )
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
