export type OrphanProductOptionRow = {
  activeValueCount: number
  activeVariantCount: number
  createdAt: Date
  deletedVariantCount: number
  optionId: string
  productLinkCount: number
  title: string
}

export type OrphanProductOptionCleanup = {
  activeValueCount: number
  deleteIds: string[]
  deletedVariantCount: number
}

const normalizedTitle = (title: string): string =>
  title.trim().toLocaleLowerCase("en-US")

export const parseExpectedCount = (args: string[]): number | undefined => {
  const argument = args.find((value) => value.startsWith("--expected-count="))
  if (!argument) {
    return undefined
  }
  const value = Number(argument.slice("--expected-count=".length))
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      "[catalog-option-orphans] --expected-count must be a non-negative integer."
    )
  }
  return value
}

export const selectSafeOrphanProductOptions = (
  rows: OrphanProductOptionRow[],
  cutoff: Date
): OrphanProductOptionCleanup => {
  const cutoffTime = cutoff.getTime()
  if (!Number.isFinite(cutoffTime)) {
    throw new Error("[catalog-option-orphans] Cleanup cutoff is invalid.")
  }

  const deleteIds = new Set<string>()
  let activeValueCount = 0
  let deletedVariantCount = 0

  rows.forEach((row) => {
    if (!row.optionId.trim() || normalizedTitle(row.title) !== "format") {
      throw new Error(
        "[catalog-option-orphans] Every cleanup target must be a Format option with an ID."
      )
    }
    if (
      !Number.isFinite(row.createdAt.getTime()) ||
      row.createdAt.getTime() >= cutoffTime
    ) {
      throw new Error(
        `[catalog-option-orphans] ${row.optionId} is not older than the cleanup cutoff.`
      )
    }
    if (row.productLinkCount !== 0) {
      throw new Error(
        `[catalog-option-orphans] ${row.optionId} has product-link history.`
      )
    }
    if (row.activeVariantCount !== 0) {
      throw new Error(
        `[catalog-option-orphans] ${row.optionId} is referenced by an active variant.`
      )
    }
    if (
      row.activeValueCount < 0 ||
      row.deletedVariantCount < 0 ||
      !Number.isSafeInteger(row.activeValueCount) ||
      !Number.isSafeInteger(row.deletedVariantCount)
    ) {
      throw new Error(
        `[catalog-option-orphans] ${row.optionId} has invalid relationship counts.`
      )
    }
    if (deleteIds.has(row.optionId)) {
      throw new Error(
        `[catalog-option-orphans] ${row.optionId} appears more than once in the audit.`
      )
    }

    deleteIds.add(row.optionId)
    activeValueCount += row.activeValueCount
    deletedVariantCount += row.deletedVariantCount
  })

  return {
    activeValueCount,
    deleteIds: Array.from(deleteIds),
    deletedVariantCount,
  }
}
