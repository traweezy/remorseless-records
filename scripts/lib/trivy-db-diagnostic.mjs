const repository = "ghcr.io/aquasecurity/trivy-db:2"
const maxAgeMs = 48 * 60 * 60 * 1000
const timestamp = (value) => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value)
  )
    return undefined
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) ? epoch : undefined
}

// Only reviewed, structured DB metadata may contribute to public diagnostics.
export const trivyDatabaseFreshnessDiagnostic = (
  metadata,
  checkedAt,
  downloadedNoLaterThan = checkedAt
) => {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    metadata.Version !== 2 ||
    !Number.isSafeInteger(checkedAt) ||
    !Number.isSafeInteger(downloadedNoLaterThan) ||
    downloadedNoLaterThan > checkedAt
  )
    return undefined
  const updated = timestamp(metadata.UpdatedAt)
  const downloaded = timestamp(metadata.DownloadedAt)
  const next = timestamp(metadata.NextUpdate)
  if (
    updated === undefined ||
    downloaded === undefined ||
    next === undefined ||
    updated > downloaded ||
    downloaded > downloadedNoLaterThan ||
    next <= updated
  )
    return undefined
  const reasonCode =
    checkedAt >= next
      ? "database_expired"
      : checkedAt - updated > maxAgeMs
        ? "database_older_than_48h"
        : undefined
  if (!reasonCode) return undefined
  return Object.freeze({
    reasonCode,
    database: Object.freeze({
      repository,
      updatedAt: new Date(updated).toISOString(),
      nextUpdate: new Date(next).toISOString(),
    }),
  })
}

export const publicTrivyFailureFields = (source) => {
  try {
    const reasonCode = source?.reasonCode
    const database = source?.database
    if (
      !["database_expired", "database_older_than_48h"].includes(reasonCode) ||
      database?.repository !== repository
    )
      return {}
    const updated = timestamp(database.updatedAt)
    const next = timestamp(database.nextUpdate)
    if (updated === undefined || next === undefined || next <= updated)
      return {}
    return {
      reasonCode,
      database: {
        repository,
        updatedAt: new Date(updated).toISOString(),
        nextUpdate: new Date(next).toISOString(),
      },
    }
  } catch {
    return {}
  }
}
