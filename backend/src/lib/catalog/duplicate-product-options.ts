export type DuplicateProductOptionRow = {
  productId: string
  handle: string
  title: string
  optionId: string
  values: string[]
  variantCount: number
}

export type DuplicateProductOptionRepair = {
  deleteIds: string[]
  productCount: number
}

const normalizedValues = (values: string[]): string[] =>
  values
    .map((value) => value.trim().toLocaleLowerCase("en-US"))
    .filter(Boolean)
    .sort()

export const selectSafeDuplicateProductOptions = (
  rows: DuplicateProductOptionRow[]
): DuplicateProductOptionRepair => {
  const groups = new Map<string, DuplicateProductOptionRow[]>()
  rows.forEach((row) => {
    const title = row.title.trim().toLocaleLowerCase("en-US")
    const key = `${row.productId}\u0000${title}`
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  })

  const deleteIds: string[] = []
  groups.forEach((group) => {
    const reference = group[0]
    if (!reference || group.length !== 2) {
      throw new Error(
        `[catalog-options] ${reference?.handle ?? "unknown"} must have exactly two duplicate options before automatic repair.`
      )
    }

    const linked = group.filter((row) => row.variantCount > 0)
    const unlinked = group.filter((row) => row.variantCount === 0)
    if (linked.length !== 1 || unlinked.length !== 1) {
      throw new Error(
        `[catalog-options] ${reference.handle} must have exactly one linked and one unlinked duplicate option.`
      )
    }

    const linkedValues = normalizedValues(linked[0]?.values ?? [])
    const unlinkedValues = normalizedValues(unlinked[0]?.values ?? [])
    if (
      linkedValues.length === 0 ||
      linked[0]?.variantCount !== linkedValues.length ||
      JSON.stringify(linkedValues) !== JSON.stringify(unlinkedValues)
    ) {
      throw new Error(
        `[catalog-options] ${reference.handle} duplicate option values or variant links do not match.`
      )
    }

    const duplicateId = unlinked[0]?.optionId
    if (!duplicateId) {
      throw new Error(
        `[catalog-options] ${reference.handle} has no unlinked option ID to repair.`
      )
    }
    deleteIds.push(duplicateId)
  })

  return {
    deleteIds: Array.from(new Set(deleteIds)),
    productCount: groups.size,
  }
}
