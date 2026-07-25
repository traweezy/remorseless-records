const LEGACY_NEW_RIBBON_LABELS = new Set(["new release", "new releases"])

export const normalizeRibbonLabel = (
  value: string | null | undefined
): string | null => {
  const label = value?.trim()
  if (!label) {
    return null
  }

  return LEGACY_NEW_RIBBON_LABELS.has(label.toLowerCase()) ? "New" : label
}
