import {
  ContainerRegistrationKeys,
  getTotalVariantAvailability,
} from "@medusajs/framework/utils"

import {
  getCatalogSourceCreatedAt,
  isCatalogShelfActive,
  isNewReleaseCandidate,
  isScheduledRecordActive,
} from "../catalog/shelves"
import { LOW_STOCK_THRESHOLD } from "../catalog/stock"

type DefaultTransformer = (
  product: Record<string, unknown>,
  options?: TransformerOptions
) => Record<string, unknown> | Promise<Record<string, unknown>>

type TransformerOptions = {
  container?: {
    hasRegistration?: (key: string) => boolean
    resolve: (key: string) => unknown
  }
  [key: string]: unknown
}

type SearchStockStatus = "in_stock" | "low_stock" | "sold_out" | "unknown"

type DynamicRecord = Record<string, unknown>

type CatalogSearchFacts = {
  profile?: DynamicRecord | null
  artists?: Array<DynamicRecord>
  references?: Array<DynamicRecord>
  referenceValues?: Array<DynamicRecord>
  variantProfiles?: Array<DynamicRecord>
  bundleProfile?: DynamicRecord | null
  bundleComponents?: Array<DynamicRecord>
  mediaItems?: Array<DynamicRecord>
  mediaAssets?: Array<DynamicRecord>
  shelves?: Array<DynamicRecord>
  shelfProducts?: Array<DynamicRecord>
}

type VariantSearchDocument = {
  id: string
  title: string | null
  sku: string | null
  format: string | null
  format_detail: string | null
  display_label: string | null
  price_amount: number | null
  price_currency: string | null
  inventory_quantity: number | null
  stock_status: SearchStockStatus
  low_stock_badge_eligible: boolean
  availability_status: string
  preorder_allowed: boolean
  preorder_release_date: string | null
  backorder_allowed: boolean
  backorder_note: string | null
  image_url: string | null
}

type MediaSearchDocument = {
  url: string
  alt: string | null
  role: string
  sort_order: number
  is_primary: boolean
  width: number | null
  height: number | null
}

export type SearchDocument = {
  id: string
  handle: string | null
  status: string | null
  title: string | null
  title_sort: string | null
  release_title: string | null
  description: string | null
  description_html: string | null
  description_text: string | null
  subtitle: string | null
  artist: string | null
  artist_names: string[]
  artist_ids: string[]
  thumbnail: string | null
  image_urls: string[]
  media: MediaSearchDocument[]
  collectionId: string | null
  collectionTitle: string | null
  collectionHandle: string | null
  label: string | null
  label_id: string | null
  genres: string[]
  metalGenres: string[]
  utility_tags: string[]
  search_keywords: string[]
  format: string | null
  formats: string[]
  format_details: string[]
  category_handles: string[]
  category_labels: string[]
  variant_titles: string[]
  variants: VariantSearchDocument[]
  price_amount: number | null
  price_min: number | null
  price_max: number | null
  price_currency: string | null
  price_compare_at: number | null
  default_variant_id: string | null
  default_variant_title: string | null
  default_variant_sku: string | null
  inventory_quantity: number | null
  low_stock_badge_eligible: boolean
  stock_status: SearchStockStatus
  stock_statuses: SearchStockStatus[]
  availability_states: string[]
  preorder_allowed: boolean
  backorder_allowed: boolean
  release_date: string | null
  release_year: number | null
  created_at: string | null
  updated_at: string | null
  product_type: string | null
  product_type_label: string | null
  bundle_type: string | null
  bundle_summary: string | null
  bundle_component_count: number
  shelf_handles: string[]
  shelf_titles: string[]
  ribbon_label: string | null
  ribbon_priority: number | null
  metadata: Record<string, unknown> | null
}

const METAL_ROOT_HANDLE = "metal"
const GENRE_HANDLES = new Set(["death", "doom", "grind", "sludge"])
const STRUCTURAL_HANDLES = new Set(["artists", "genres"])

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString()
  }

  return null
}

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true"
  }
  return false
}

const toRecord = (value: unknown): DynamicRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as DynamicRecord)
    : null

const toRecordList = (value: unknown): DynamicRecord[] =>
  Array.isArray(value)
    ? value
        .map((entry) => toRecord(entry))
        .filter((entry): entry is DynamicRecord => Boolean(entry))
    : []

const toSortNumber = (value: unknown, fallback = 0): number =>
  toNumberOrNull(value) ?? fallback

const toStringList = (value: unknown): string[] => {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => toStringOrNull(entry))
      .filter((entry): entry is string => Boolean(entry))
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }
  return []
}

const unique = (values: Array<string | null | undefined>): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  )

const humanizeHandle = (handle: string): string =>
  handle
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")

const stripHtml = (value: string | null): string | null => {
  if (!value) {
    return null
  }
  const stripped = value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
  return stripped.length ? stripped : null
}

const toIsoOrNull = (value: unknown): string | null => {
  const raw = toStringOrNull(value)
  if (!raw) {
    return null
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const isFutureIso = (value: string | null): boolean => {
  if (!value) {
    return false
  }
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now()
}

const getFirstImageUrl = (product: DynamicRecord): string | null => {
  if (typeof product.thumbnail === "string" && product.thumbnail.trim().length) {
    return product.thumbnail.trim()
  }

  const images = toRecordList(product.images)
  const image = images?.find((img) => typeof img?.url === "string")
  return toStringOrNull(image?.url)
}

const coerceCategoryHandle = (
  category: DynamicRecord | null | undefined
): string | null => {
  const handle = category?.handle
  if (typeof handle === "string" && handle.trim().length) {
    return handle.trim().toLowerCase()
  }
  return null
}

const coerceCategoryLabel = (
  category: DynamicRecord | null | undefined,
  defaultHandle: string
): string => {
  const name = category?.name
  if (typeof name === "string" && name.trim().length) {
    return name.trim()
  }
  return humanizeHandle(defaultHandle)
}

const collectCategoryLabels = (
  categories: Array<DynamicRecord> | undefined,
  allowedHandles: Set<string>
): Map<string, string> => {
  if (!categories?.length) {
    return new Map<string, string>()
  }

  const labels = new Map<string, string>()
  for (const category of categories) {
    const handle = coerceCategoryHandle(category)
    if (!handle || !allowedHandles.has(handle)) {
      continue
    }

    const label = coerceCategoryLabel(category, handle)
    labels.set(handle, label)
  }

  return labels
}

const collectAncestors = (
  category: DynamicRecord | null | undefined
): Array<DynamicRecord> => {
  const ancestors: Array<DynamicRecord> = []
  let current: DynamicRecord | null | undefined = category
  let guard = 0

  while (current && guard < 16) {
    ancestors.push(current)
    current = toRecord(current.parent_category)
    guard += 1
  }

  return ancestors
}

const findRootCategory = (
  category: DynamicRecord | null | undefined
): DynamicRecord | null => {
  const ancestors = collectAncestors(category)
  return ancestors.length ? ancestors[ancestors.length - 1] ?? null : null
}

const shouldExcludeCategory = (
  category: DynamicRecord | null | undefined
): boolean => {
  const handle = coerceCategoryHandle(category)
  if (!handle) {
    return true
  }

  if (STRUCTURAL_HANDLES.has(handle)) {
    return true
  }

  const root = findRootCategory(category)
  const rootHandle = root ? coerceCategoryHandle(root) : null
  return rootHandle === "artists"
}

const collectNonArtistCategoryEntries = (
  categories: Array<DynamicRecord> | undefined
): Map<string, string> => {
  if (!categories?.length) {
    return new Map<string, string>()
  }

  const entries = new Map<string, string>()

  categories.forEach((category) => {
    if (shouldExcludeCategory(category)) {
      return
    }

    const handle = coerceCategoryHandle(category)
    if (!handle) {
      return
    }

    const label = coerceCategoryLabel(category, handle)
    entries.set(handle, label)
  })

  return entries
}

const collectMetalGenreLabels = (
  categories: Array<DynamicRecord> | undefined
): string[] => {
  if (!categories?.length) {
    return []
  }

  const labels = new Set<string>()
  for (const category of categories) {
    const handle = coerceCategoryHandle(category)
    if (!handle) {
      continue
    }
    if (handle === METAL_ROOT_HANDLE) {
      continue
    }

    const ancestors = collectAncestors(category)
    const hasMetalAncestor = ancestors.some(
      (ancestor) => coerceCategoryHandle(ancestor) === METAL_ROOT_HANDLE
    )

    if (!hasMetalAncestor) {
      continue
    }

    labels.add(coerceCategoryLabel(category, handle))
  }

  return Array.from(labels)
}

const findFormatOptionValues = (product: DynamicRecord): string[] => {
  const formatValues = new Set<string>()

  toRecordList(product.options)
    .filter((option) => {
      const title = toStringOrNull(option?.title)
      return title?.toLowerCase() === "format"
    })
    .forEach((option) => {
      toRecordList(option.values).forEach((value) => {
        const label = toStringOrNull(value?.value)
        if (label) {
          formatValues.add(label)
        }
      })
    })

  for (const variant of toRecordList(product.variants)) {
    for (const variantOption of toRecordList(variant?.options)) {
      const option = toRecord(variantOption.option)
      const optionValue = toRecord(variantOption.option_value)
      const optionTitle = toStringOrNull(
        variantOption?.option_title ?? option?.title
      )

      if (optionTitle?.toLowerCase() === "format") {
        const value = toStringOrNull(
          variantOption?.value ?? optionValue?.value
        )
        if (value) {
          formatValues.add(value)
        }
      }
    }
  }

  return Array.from(formatValues)
}

const selectPrimaryVariant = (
  variants?: Array<DynamicRecord> | null
): DynamicRecord | null => {
  if (!variants?.length) {
    return null
  }

  const available = variants.find((variant) => {
    const manageInventory = Boolean(
      variant?.manage_inventory ?? variant?.manageInventory
    )

    const quantity = Number(
      variant?.inventory_quantity ?? variant?.inventoryQuantity ?? 0
    )

    return manageInventory ? quantity > 0 : true
  })

  return (available ?? variants[0]) ?? null
}

const pickPrice = (
  variant: DynamicRecord | null
): { amount: number | null; currency: string | null; compareAt: number | null } => {
  const prices = toRecordList(variant?.prices)
    .map((price) => {
      const amount = toNumberOrNull(price.amount)
      const currency = toStringOrNull(price.currency_code)
      if (amount === null || !currency) {
        return null
      }
      return {
        amount,
        currency_code: currency,
        compare_at_amount: toNumberOrNull(price.compare_at_amount),
      }
    })
    .filter(
      (
        price
      ): price is {
        amount: number
        currency_code: string
        compare_at_amount: number | null
      } => Boolean(price)
    )

  if (!prices.length) {
    return { amount: null, currency: null, compareAt: null }
  }

  const preferredCurrencyOrder = ["usd", "eur"]

  const preferred =
    prices.find((price) =>
      preferredCurrencyOrder.includes(price.currency_code?.toLowerCase() ?? "")
    ) ?? prices[0]

  return {
    amount: preferred?.amount ?? null,
    currency: preferred?.currency_code ?? null,
    compareAt: preferred?.compare_at_amount ?? null,
  }
}

const resolveStockStatus = (variant: DynamicRecord | null): {
  status: SearchStockStatus
  quantity: number | null
} => {
  if (!variant) {
    return { status: "unknown", quantity: null }
  }

  const manageInventory = Boolean(
    variant?.manage_inventory ?? variant?.manageInventory
  )

  const quantityRaw = variant?.inventory_quantity ?? variant?.inventoryQuantity

  const quantity =
    typeof quantityRaw === "number"
      ? quantityRaw
      : typeof quantityRaw === "string"
        ? Number.parseInt(quantityRaw, 10)
        : null

  if (!manageInventory) {
    return { status: "in_stock", quantity }
  }

  if (quantity === null || !Number.isFinite(quantity)) {
    return { status: "unknown", quantity: null }
  }

  if (quantity <= 0) {
    return { status: "sold_out", quantity }
  }

  if (quantity <= LOW_STOCK_THRESHOLD) {
    return { status: "low_stock", quantity }
  }

  return { status: "in_stock", quantity }
}

const isLowStockBadgeEligible = (
  variant: DynamicRecord,
  status: SearchStockStatus,
  quantity: number | null
): boolean => {
  if (status !== "low_stock") {
    return true
  }

  const metadata = toRecord(variant.metadata)
  const countStatus = toStringOrNull(metadata?.inventory_count_status)
  if (countStatus === "verified") {
    return true
  }

  const seededQuantity = toNumberOrNull(metadata?.seed_inventory_quantity)
  const isImportedEstimate =
    toBoolean(metadata?.source_low_inventory) &&
    seededQuantity !== null &&
    quantity === seededQuantity

  return !isImportedEstimate && countStatus !== "unknown"
}

const aggregateStockStatus = (
  statuses: SearchStockStatus[]
): SearchStockStatus => {
  if (statuses.includes("in_stock")) {
    return "in_stock"
  }
  if (statuses.includes("low_stock")) {
    return "low_stock"
  }
  if (statuses.includes("sold_out")) {
    return "sold_out"
  }
  return "unknown"
}

const resolveReferenceValue = (
  facts: CatalogSearchFacts | undefined,
  id: string | null | undefined
): DynamicRecord | null => {
  if (!id) {
    return null
  }
  return facts?.referenceValues?.find((value) => toStringOrNull(value.id) === id) ?? null
}

const resolveReferenceLabel = (
  facts: CatalogSearchFacts | undefined,
  id: string | null | undefined
): string | null => {
  const value = resolveReferenceValue(facts, id)
  return toStringOrNull(value?.label ?? value?.value)
}

const referenceLabelsByKind = (
  facts: CatalogSearchFacts | undefined,
  kind: string
): string[] => {
  if (!facts?.references?.length) {
    return []
  }

  return facts.references
    .filter((reference) => reference.kind === kind)
    .sort((a, b) => toSortNumber(a.sort_order) - toSortNumber(b.sort_order))
    .map((reference) =>
      resolveReferenceValue(facts, toStringOrNull(reference.reference_value_id))
    )
    .map((value) => toStringOrNull(value?.label ?? value?.value))
    .filter((value): value is string => Boolean(value))
}

const mapMediaDocuments = (
  facts: CatalogSearchFacts | undefined
): MediaSearchDocument[] => {
  if (!facts?.mediaItems?.length) {
    return []
  }

  return facts.mediaItems
    .map((item) => {
      const asset = facts.mediaAssets?.find(
        (candidate) =>
          toStringOrNull(candidate.id) === toStringOrNull(item.media_asset_id)
      )
      const url = toStringOrNull(asset?.source_url)
      if (!url) {
        return null
      }
      return {
        url,
        alt: toStringOrNull(asset?.alt_text),
        role: toStringOrNull(item.role) ?? "gallery",
        sort_order: toNumberOrNull(item.sort_order) ?? 0,
        is_primary: toBoolean(item.is_primary),
        width: toNumberOrNull(asset?.width),
        height: toNumberOrNull(asset?.height),
      } satisfies MediaSearchDocument
    })
    .filter((media): media is MediaSearchDocument => Boolean(media))
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)
}

const variantProfileFor = (
  facts: CatalogSearchFacts | undefined,
  variantId: string | null | undefined
): DynamicRecord | null => {
  if (!variantId) {
    return null
  }
  return facts?.variantProfiles?.find(
    (profile) => toStringOrNull(profile.variant_id) === variantId
  ) ?? null
}

const mapVariantDocument = (
  variant: DynamicRecord,
  facts: CatalogSearchFacts | undefined
): VariantSearchDocument => {
  const profile = variantProfileFor(facts, toStringOrNull(variant.id))
  const { amount, currency } = pickPrice(variant)
  const { status, quantity } = resolveStockStatus(variant)
  const format = resolveReferenceLabel(
    facts,
    toStringOrNull(profile?.format_id ?? profile?.formatId)
  )
  const formatDetail = resolveReferenceLabel(
    facts,
    toStringOrNull(profile?.format_detail_id ?? profile?.formatDetailId)
  )
  const availabilityStatus =
    toStringOrNull(profile?.availability_status) ??
    (profile?.preorder_allowed ? "preorder" : null) ??
    (profile?.backorder_allowed ? "backorder" : null) ??
    status

  return {
    id: toStringOrNull(variant.id) ?? "",
    title: toStringOrNull(variant.title),
    sku: toStringOrNull(variant.sku),
    format:
      toStringOrNull(profile?.format_label ?? profile?.formatLabel) ??
      format ??
      toStringOrNull(variant.title),
    format_detail:
      toStringOrNull(profile?.format_detail_label ?? profile?.formatDetailLabel) ??
      formatDetail,
    display_label:
      toStringOrNull(profile?.display_label ?? profile?.displayLabel) ??
      toStringOrNull(profile?.format_detail_label ?? profile?.formatDetailLabel) ??
      formatDetail ??
      toStringOrNull(profile?.format_label ?? profile?.formatLabel) ??
      format ??
      toStringOrNull(variant.title),
    price_amount: amount,
    price_currency: currency,
    inventory_quantity: quantity,
    stock_status: status,
    low_stock_badge_eligible: isLowStockBadgeEligible(
      variant,
      status,
      quantity
    ),
    availability_status: availabilityStatus,
    preorder_allowed: toBoolean(profile?.preorder_allowed),
    preorder_release_date: toIsoOrNull(profile?.preorder_release_date),
    backorder_allowed: toBoolean(profile?.backorder_allowed),
    backorder_note: toStringOrNull(profile?.backorder_note),
    image_url: toStringOrNull(profile?.image_url),
  }
}

const resolveAvailabilityStates = (
  variants: VariantSearchDocument[],
  releaseDate: string | null
): string[] => {
  const states = new Set<string>()
  variants.forEach((variant) => {
    states.add(variant.stock_status)
    if (
      ["preorder", "backorder", "coming_soon"].includes(
        variant.availability_status
      )
    ) {
      states.add(variant.availability_status)
    }
    if (variant.preorder_allowed) {
      states.add("preorder")
    }
    if (variant.backorder_allowed) {
      states.add("backorder")
    }
  })
  if (isFutureIso(releaseDate) && !states.has("preorder")) {
    states.add("coming_soon")
  }
  return unique(Array.from(states))
}

const getCatalogImport = (
  metadata: Record<string, unknown> | null
): DynamicRecord | null => toRecord(metadata?.catalog_import)

export const buildSearchDocument = (
  product: DynamicRecord,
  facts?: CatalogSearchFacts
): SearchDocument => {
  const normalizedProduct = product ?? {}
  const defaultVariant = selectPrimaryVariant(toRecordList(normalizedProduct.variants))
  const { amount, currency, compareAt } = pickPrice(defaultVariant)

  const collection = toRecord(normalizedProduct.collection)
  const categories = toRecordList(normalizedProduct.categories)

  const genreEntries = collectCategoryLabels(categories, GENRE_HANDLES)
  const nonArtistEntries = collectNonArtistCategoryEntries(categories)

  const categoryGenres = Array.from(genreEntries.values())
  const categoryHandles = Array.from(nonArtistEntries.keys())
  const categoryLabels = Array.from(nonArtistEntries.values())
  const metalGenres = collectMetalGenreLabels(categories)

  const metadata = (normalizedProduct.metadata ??
    null) as Record<string, unknown> | null
  const catalogImport = getCatalogImport(metadata)
  const legacyImport = toRecord(metadata?.legacy_import)
  const profile = facts?.profile ?? null
  const sourceCreatedAt = getCatalogSourceCreatedAt(profile?.metadata)

  const referenceGenres = referenceLabelsByKind(facts, "genre")
  const utilityTags = unique([
    ...referenceLabelsByKind(facts, "utility_tag"),
    ...toStringList(catalogImport?.utility_tags),
  ])

  const artistNames = unique([
    ...(facts?.artists ?? [])
      .sort((a, b) => toSortNumber(a.sort_order) - toSortNumber(b.sort_order))
      .map((artist) => toStringOrNull(artist.display_name)),
    ...toStringList(catalogImport?.artists),
    toStringOrNull(metadata?.artist),
    toStringOrNull(normalizedProduct.subtitle),
  ])
  const artistIds = unique(
    (facts?.artists ?? []).map((artist) => toStringOrNull(artist.artist_id))
  )

  const labelValue = resolveReferenceValue(facts, toStringOrNull(profile?.label_id))
  const label =
    toStringOrNull(labelValue?.label ?? labelValue?.value) ??
    toStringOrNull(catalogImport?.label)
  const labelId = toStringOrNull(profile?.label_id)

  const productTypeValue = resolveReferenceValue(
    facts,
    toStringOrNull(profile?.product_type_id)
  )
  const productType =
    toStringOrNull(productTypeValue?.value) ??
    toStringOrNull(catalogImport?.product_type) ??
    toStringOrNull(legacyImport?.product_type) ??
    toStringOrNull(metadata?.product_type)
  const productTypeLabel =
    toStringOrNull(productTypeValue?.label) ??
    (productType ? humanizeHandle(productType.replace(/_/g, "-")) : null)

  const releaseTitle =
    toStringOrNull(profile?.release_title) ??
    toStringOrNull(catalogImport?.release_title) ??
    toStringOrNull(normalizedProduct.title)
  const releaseDate =
    toIsoOrNull(profile?.release_date) ??
    toIsoOrNull(catalogImport?.release_date)
  const releaseYear =
    toNumberOrNull(profile?.release_year) ??
    toNumberOrNull(catalogImport?.release_year)

  const descriptionHtml =
    toStringOrNull(profile?.description_html) ??
    toStringOrNull(catalogImport?.description_html)
  const description =
    stripHtml(descriptionHtml) ??
    toStringOrNull(normalizedProduct.description ?? normalizedProduct.subtitle)

  const productVariants = toRecordList(normalizedProduct.variants)

  const variantDocuments: VariantSearchDocument[] = productVariants.map(
    (variant: DynamicRecord) => mapVariantDocument(variant, facts)
  )
  const defaultVariantDocument =
    variantDocuments.find((variant) => variant.id === defaultVariant?.id) ??
    variantDocuments[0] ??
    null
  const stockStatuses = unique(
    variantDocuments.map((variant) => variant.stock_status)
  ) as SearchStockStatus[]
  const stockStatus = aggregateStockStatus(stockStatuses)
  const lowStockBadgeEligible = variantDocuments.some(
    (variant) =>
      variant.stock_status === "low_stock" && variant.low_stock_badge_eligible
  )

  const priceAmounts = variantDocuments
    .map((variant) => variant.price_amount)
    .filter((value): value is number => typeof value === "number")
  const priceMin = priceAmounts.length ? Math.min(...priceAmounts) : amount
  const priceMax = priceAmounts.length ? Math.max(...priceAmounts) : amount

  const formatLabels = unique([
    ...findFormatOptionValues(normalizedProduct),
    ...variantDocuments.map((variant) => variant.format),
  ])
  const formatDetails = unique(
    variantDocuments.map((variant) => variant.format_detail)
  )
  const variantTitles = unique(
    variantDocuments.map((variant) => variant.title)
  )

  const media = mapMediaDocuments(facts)
  const imageUrls = unique([
    ...media.map((entry) => entry.url),
    getFirstImageUrl(normalizedProduct),
    ...toRecordList(normalizedProduct.images).map((image) => toStringOrNull(image?.url)),
    ...variantDocuments.map((variant) => variant.image_url),
  ])
  const thumbnail = media.find((entry) => entry.is_primary)?.url ?? imageUrls[0] ?? null

  const activeMembershipShelfIds = new Set(
    (facts?.shelfProducts ?? [])
      .filter((membership) => isScheduledRecordActive(membership))
      .map((membership) => toStringOrNull(membership.shelf_id))
      .filter((id): id is string => Boolean(id))
  )
  const activeShelves = (facts?.shelves ?? []).filter((shelf) => {
    if (!isCatalogShelfActive(shelf)) {
      return false
    }
    const shelfId = toStringOrNull(shelf.id)
    const isAutomaticNewRelease =
      (shelf.mode === "automatic" || shelf.mode === "hybrid") &&
      shelf.automation_type === "new_release"
    return (
      isAutomaticNewRelease ||
      !facts?.shelfProducts ||
      (shelfId !== null && activeMembershipShelfIds.has(shelfId))
    )
  })
  const ribbonShelf =
    activeShelves
      .filter((shelf) => toBoolean(shelf.show_ribbon))
      .sort((a, b) => toSortNumber(a.ribbon_priority, 100) - toSortNumber(b.ribbon_priority, 100))[0] ??
    null

  const bundleComponentCount = facts?.bundleComponents?.length ?? 0
  const bundleSummary =
    toStringOrNull(facts?.bundleProfile?.display_title) ??
    (bundleComponentCount > 0
      ? `${bundleComponentCount} included item${bundleComponentCount === 1 ? "" : "s"}`
      : null)

  const genres = unique([
    ...referenceGenres,
    ...toStringList(catalogImport?.genres),
    ...categoryGenres,
    ...toStringList(toRecordList(normalizedProduct.tags).map((tag) => tag?.value)),
  ])

  const availabilityStates = resolveAvailabilityStates(
    variantDocuments,
    releaseDate
  )

  return {
    id: toStringOrNull(normalizedProduct.id) ?? "",
    handle: toStringOrNull(normalizedProduct.handle),
    status: toStringOrNull(normalizedProduct.status),
    title: toStringOrNull(normalizedProduct.title),
    title_sort: (releaseTitle ?? toStringOrNull(normalizedProduct.title))?.toLowerCase() ?? null,
    release_title: releaseTitle,
    description,
    description_html: descriptionHtml,
    description_text: description,
    subtitle: toStringOrNull(normalizedProduct.subtitle),
    artist: artistNames.join(" / ") || null,
    artist_names: artistNames,
    artist_ids: artistIds,
    thumbnail,
    image_urls: imageUrls,
    media,
    collectionId: toStringOrNull(collection?.id),
    collectionTitle: toStringOrNull(collection?.title),
    collectionHandle: toStringOrNull(collection?.handle),
    label,
    label_id: labelId,
    genres,
    metalGenres: metalGenres.length ? metalGenres : genres,
    utility_tags: utilityTags,
    search_keywords: unique([
      ...toStringList(profile?.search_keywords),
      ...toStringList(catalogImport?.search_keywords),
      ...artistNames,
      releaseTitle,
      label,
      ...genres,
      ...formatLabels,
      ...formatDetails,
      bundleSummary,
    ]),
    format: formatLabels[0] ?? null,
    formats: formatLabels,
    format_details: formatDetails,
    category_handles: categoryHandles,
    category_labels: categoryLabels,
    variant_titles: variantTitles,
    variants: variantDocuments,
    price_amount: amount,
    price_min: priceMin,
    price_max: priceMax,
    price_currency: currency ?? defaultVariantDocument?.price_currency ?? null,
    price_compare_at: compareAt ?? null,
    default_variant_id: defaultVariantDocument?.id ?? null,
    default_variant_title: defaultVariantDocument?.title ?? null,
    default_variant_sku: defaultVariantDocument?.sku ?? null,
    inventory_quantity: defaultVariantDocument?.inventory_quantity ?? null,
    low_stock_badge_eligible: lowStockBadgeEligible,
    stock_status: stockStatus,
    stock_statuses: stockStatuses,
    availability_states: availabilityStates,
    preorder_allowed: variantDocuments.some((variant) => variant.preorder_allowed),
    backorder_allowed: variantDocuments.some((variant) => variant.backorder_allowed),
    release_date: releaseDate,
    release_year: releaseYear,
    created_at:
      sourceCreatedAt ??
      toIsoOrNull(normalizedProduct.created_at ?? normalizedProduct.createdAt),
    updated_at: toIsoOrNull(normalizedProduct.updated_at ?? normalizedProduct.updatedAt),
    product_type: productType,
    product_type_label: productTypeLabel,
    bundle_type: toStringOrNull(facts?.bundleProfile?.bundle_type),
    bundle_summary: bundleSummary,
    bundle_component_count: bundleComponentCount,
    shelf_handles: unique(activeShelves.map((shelf) => toStringOrNull(shelf.handle))),
    shelf_titles: unique(activeShelves.map((shelf) => toStringOrNull(shelf.title))),
    ribbon_label: toStringOrNull(ribbonShelf?.ribbon_label ?? ribbonShelf?.title),
    ribbon_priority: toNumberOrNull(ribbonShelf?.ribbon_priority),
    metadata:
      typeof metadata === "object" && metadata !== null
        ? metadata
        : null,
  }
}

const safeList = async (
  catalogService: DynamicRecord,
  method: string,
  filters: Record<string, unknown>
): Promise<Array<DynamicRecord>> => {
  const fn = catalogService[method]
  if (typeof fn !== "function") {
    return []
  }
  const result = await fn.call(catalogService, filters)
  return Array.isArray(result) ? result : []
}

let automaticShelfCache = new WeakMap<
  object,
  { expiresAt: number; shelves: Promise<DynamicRecord[]> }
>()

export const clearAutomaticShelfCache = (): void => {
  automaticShelfCache = new WeakMap()
}

const loadAutomaticShelves = (
  catalogService: DynamicRecord
): Promise<DynamicRecord[]> => {
  const cacheKey = catalogService as object
  const now = Date.now()
  const cached = automaticShelfCache.get(cacheKey)
  if (cached && cached.expiresAt > now) {
    return cached.shelves
  }

  const shelves = safeList(catalogService, "listCatalogShelves", {
    is_active: true,
    automation_type: "new_release",
  })
  automaticShelfCache.set(cacheKey, {
    expiresAt: now + 30_000,
    shelves,
  })
  return shelves
}

const loadCatalogFacts = async (
  product: DynamicRecord,
  options?: TransformerOptions
): Promise<CatalogSearchFacts | undefined> => {
  const container = options?.container
  if (!container) {
    return undefined
  }
  if (container.hasRegistration && !container.hasRegistration("catalog")) {
    return undefined
  }

  const productId = toStringOrNull(product.id)
  if (!productId) {
    return undefined
  }

  try {
    const catalogService = container.resolve("catalog") as DynamicRecord
    const profiles = await safeList(catalogService, "listCatalogProductProfiles", {
      product_id: productId,
    })
    const profile = profiles[0] ?? null
    const profileId = toStringOrNull(profile?.id)
    const productVariants = Array.isArray(product.variants)
      ? (product.variants as Array<DynamicRecord>)
      : []
    const variantIds = productVariants
      .map((variant) => toStringOrNull(variant.id))
      .filter((id): id is string => Boolean(id))

    const [
      artists,
      references,
      variantProfiles,
      bundleProfiles,
      mediaItems,
      shelfProducts,
    ] = await Promise.all([
      profileId
        ? safeList(catalogService, "listCatalogProductArtists", {
            product_profile_id: profileId,
          })
        : Promise.resolve([]),
      profileId
        ? safeList(catalogService, "listCatalogProductReferences", {
            product_profile_id: profileId,
          })
        : Promise.resolve([]),
      variantIds.length
        ? safeList(catalogService, "listCatalogVariantProfiles", {
            variant_id: variantIds,
          })
        : Promise.resolve([]),
      safeList(catalogService, "listCatalogBundleProfiles", {
        product_id: productId,
      }),
      safeList(catalogService, "listCatalogProductMediaItems", {
        product_id: productId,
      }),
      safeList(catalogService, "listCatalogShelfProducts", {
        product_id: productId,
      }),
    ])

    const bundleProfile = bundleProfiles[0] ?? null
    const bundleComponents = bundleProfile?.id
      ? await safeList(catalogService, "listCatalogBundleComponents", {
          bundle_profile_id: bundleProfile.id,
        })
      : []

    const referenceIds = unique([
      toStringOrNull(profile?.label_id),
      toStringOrNull(profile?.product_type_id),
      ...references.map((reference) => toStringOrNull(reference.reference_value_id)),
      ...variantProfiles.flatMap((profile) => [
        toStringOrNull(profile.format_id ?? profile.formatId),
        toStringOrNull(profile.format_detail_id ?? profile.formatDetailId),
      ]),
    ])
    const mediaAssetIds = unique(
      mediaItems.map((item) => toStringOrNull(item.media_asset_id))
    )
    const shelfIds = unique(
      shelfProducts.map((item) => toStringOrNull(item.shelf_id))
    )

    const [referenceValues, mediaAssets, linkedShelves, automaticShelves] = await Promise.all([
      referenceIds.length
        ? safeList(catalogService, "listCatalogReferenceValues", { id: referenceIds })
        : Promise.resolve([]),
      mediaAssetIds.length
        ? safeList(catalogService, "listCatalogMediaAssets", { id: mediaAssetIds })
        : Promise.resolve([]),
      shelfIds.length
        ? safeList(catalogService, "listCatalogShelves", { id: shelfIds })
        : Promise.resolve([]),
      loadAutomaticShelves(catalogService),
    ])
    const eligibleAutomaticShelves = automaticShelves.filter(
      (shelf) =>
        (shelf.mode === "automatic" || shelf.mode === "hybrid") &&
        isNewReleaseCandidate({
          shelf,
          releaseDate: profile?.release_date,
          createdAt:
            getCatalogSourceCreatedAt(profile?.metadata) ??
            product.created_at ??
            product.createdAt,
        })
    )
    const shelves = Array.from(
      new Map(
        [...linkedShelves, ...eligibleAutomaticShelves].flatMap((shelf) => {
          const id = toStringOrNull(shelf.id)
          return id ? [[id, shelf] as const] : []
        })
      ).values()
    )

    return {
      profile,
      artists,
      references,
      referenceValues,
      variantProfiles,
      bundleProfile,
      bundleComponents,
      mediaItems,
      mediaAssets,
      shelves,
      shelfProducts,
    }
  } catch {
    return undefined
  }
}

const loadVariantAvailability = async (
  product: DynamicRecord,
  options?: TransformerOptions
): Promise<Record<string, number | null>> => {
  const container = options?.container
  if (!container) {
    return {}
  }

  const variantIds = toRecordList(product.variants)
    .map((variant) => toStringOrNull(variant.id))
    .filter((id): id is string => Boolean(id))
  if (!variantIds.length) {
    return {}
  }

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Parameters<
      typeof getTotalVariantAvailability
    >[0]
    const availability = await getTotalVariantAvailability(query, {
      variant_ids: variantIds,
    })

    return Object.fromEntries(
      variantIds.map((variantId) => [
        variantId,
        availability[variantId]?.availability ?? null,
      ])
    )
  } catch {
    return {}
  }
}

const mergeVariantAvailability = (
  product: DynamicRecord,
  availability: Record<string, number | null>
): DynamicRecord => ({
  ...product,
  variants: toRecordList(product.variants).map((variant) => {
    const variantId = toStringOrNull(variant.id)
    const quantity = variantId ? availability[variantId] : null
    return typeof quantity === "number"
      ? { ...variant, inventory_quantity: quantity }
      : variant
  }),
})

const productSearchTransformer = async (
  product: Record<string, unknown>,
  defaultTransformer: DefaultTransformer,
  options?: TransformerOptions
): Promise<SearchDocument> => {
  const transformed = (await defaultTransformer(product, options)) as DynamicRecord
  const [catalogFacts, availability] = await Promise.all([
    loadCatalogFacts(transformed, options),
    loadVariantAvailability(transformed, options),
  ])
  return buildSearchDocument(
    mergeVariantAvailability(transformed, availability),
    catalogFacts
  )
}

export default productSearchTransformer
