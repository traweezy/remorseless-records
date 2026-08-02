export const buildStoreNewsFilters = (
  now: Date
): Record<string, unknown> => ({
  archived_at: null,
  published_at: { $lte: now },
  status: { $in: ["published", "scheduled"] },
})
