import type {
  BundleComposition,
  BundleCompositionItem,
  BundleVariantAvailability,
} from "@/types/bundle"

export type BundleItemAvailabilityStatus = "in_stock" | "sold_out" | "unknown"

export type BundleItemPresentation = {
  formatLabel: string | null
  status: BundleItemAvailabilityStatus
}

const normalizeBundleVariantTitle = (title: string): string | null => {
  const normalized = title.replace(/\s*bundle$/i, "").trim()
  return normalized.length ? normalized : null
}

export const resolveBundleVariantAvailability = (
  item: BundleCompositionItem,
  selectedBundleVariantId: string | null
): BundleVariantAvailability | null => {
  if (selectedBundleVariantId) {
    return (
      item.availabilityByBundleVariant.find((mapping) =>
        mapping.bundleVariantIds.includes(selectedBundleVariantId)
      ) ?? null
    )
  }

  return item.availabilityByBundleVariant[0] ?? null
}

export const buildBundleItemPresentation = (
  item: BundleCompositionItem,
  selectedBundleVariantId: string | null
): BundleItemPresentation => {
  const mapping = resolveBundleVariantAvailability(
    item,
    selectedBundleVariantId
  )
  if (!mapping) {
    return {
      formatLabel: null,
      status: "unknown",
    }
  }

  const formatLabels = Array.from(
    new Set(
      mapping.bundleVariantTitles
        .map(normalizeBundleVariantTitle)
        .filter((label): label is string => Boolean(label))
    )
  )

  return {
    formatLabel: formatLabels.length ? formatLabels.join(" / ") : null,
    status: mapping.available ? "in_stock" : "sold_out",
  }
}

export const hasUnavailableBundleComponents = (
  bundle: BundleComposition,
  selectedBundleVariantId: string | null
): boolean =>
  bundle.components.some(
    (component) =>
      buildBundleItemPresentation(component, selectedBundleVariantId).status ===
      "sold_out"
  )

export const buildBundleAvailabilityNotices = (
  bundle: BundleComposition
): Record<string, string> => {
  const unavailableNamesByVariantId = new Map<string, string[]>()
  bundle.components.forEach((component) => {
    component.availabilityByBundleVariant.forEach((mapping) => {
      if (mapping.available) {
        return
      }
      mapping.bundleVariantIds.forEach((variantId) => {
        const names = unavailableNamesByVariantId.get(variantId) ?? []
        names.push(component.title)
        unavailableNamesByVariantId.set(variantId, names)
      })
    })
  })

  return Object.fromEntries(
    Array.from(unavailableNamesByVariantId, ([variantId, names]) => [
      variantId,
      `${names.length} included item${names.length === 1 ? " is" : "s are"} sold out: ${names.join(", ")}.`,
    ])
  )
}
