type DefaultTransformer = (
  product: Record<string, unknown>,
  options?: Record<string, unknown>
) => Record<string, unknown>

type TransformerOptions = Record<string, unknown>

type SearchDocument = {
  id: string
  handle: string | null
  title: string | null
  description: string | null
  subtitle: string | null
  artist: string | null
  thumbnail: string | null
  collectionId: string | null
  collectionTitle: string | null
  collectionHandle: string | null
  genres: string[]
  metalGenres: string[]
  format: string | null
  category_handles: string[]
  category_labels: string[]
  variant_titles: string[]
  price_amount: number | null
  price_currency: string | null
  price_compare_at: number | null
  default_variant_id: string | null
  default_variant_title: string | null
  default_variant_sku: string | null
  inventory_quantity: number | null
  stock_status: "in_stock" | "low_stock" | "sold_out" | "unknown"
  created_at: string | null
  updated_at: string | null
  product_type: string | null
  metadata: Record<string, unknown> | null
}

const toStringOrNull = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString()
  }

  return null
}

const getFirstImageUrl = (product: Record<string, any>): string | null => {
  if (typeof product.thumbnail === "string" && product.thumbnail.length) {
    return product.thumbnail
  }

  const images = product.images as Array<Record<string, any>> | undefined
  const image = images?.find((img) => typeof img?.url === "string")
  return image?.url ?? null
}

const humanizeHandle = (handle: string): string =>
  handle
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ")

const TYPE_HANDLES = new Set(["music", "bundles", "merch"])
const METAL_ROOT_HANDLE = "metal"
const GENRE_HANDLES = new Set(["metal", "death", "doom", "grind", "sludge"])
const STRUCTURAL_HANDLES = new Set(["artists", "genres"])

const coerceCategoryHandle = (category: Record<string, any> | null | undefined): string | null => {
  const handle = category?.handle
  if (typeof handle === "string" && handle.trim().length) {
    return handle.trim().toLowerCase()
  }
  return null
}

const coerceCategoryLabel = (
  category: Record<string, any> | null | undefined,
  defaultHandle: string
): string => {
  const name = category?.name
  if (typeof name === "string" && name.trim().length) {
    return name.trim()
  }
  return humanizeHandle(defaultHandle)
}

const collectCategoryLabels = (
  categories: Array<Record<string, any>> | undefined,
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

const collectAncestors = (category: Record<string, any> | null | undefined): Array<Record<string, any>> => {
  const ancestors: Array<Record<string, any>> = []
  let current: Record<string, any> | null | undefined = category
  let guard = 0

  while (current && guard < 16) {
    ancestors.push(current)
    current = current.parent_category ?? null
    guard += 1
  }

  return ancestors
}

const findRootCategory = (category: Record<string, any> | null | undefined): Record<string, any> | null => {
  const ancestors = collectAncestors(category)
  return ancestors.length ? ancestors[ancestors.length - 1] ?? null : null
}

const shouldExcludeCategory = (category: Record<string, any> | null | undefined): boolean => {
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
  categories: Array<Record<string, any>> | undefined
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
  categories: Array<Record<string, any>> | undefined
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

    const ancestors = collectAncestors(category)
    const hasMetalAncestor = ancestors.some((ancestor) =>
      coerceCategoryHandle(ancestor) === METAL_ROOT_HANDLE
    )

    if (!hasMetalAncestor) {
      continue
    }

    const label = coerceCategoryLabel(category, handle)
    labels.add(label)
  }

  return Array.from(labels)
}

const getTagGenres = (tags?: Array<Record<string, any>> | null): string[] => {
  if (!tags?.length) {
    return []
  }

  const values = tags
    .map((tag) => (typeof tag?.value === "string" ? tag.value.trim() : null))
    .filter((value): value is string => Boolean(value))

  return Array.from(new Set(values))
}

const findFormatOption = (product: Record<string, any>): string | null => {
  const optionMatch =
    product.options?.find((option: Record<string, any>) => {
      const title = toStringOrNull(option?.title)
      return title?.toLowerCase() === "format"
    }) ?? null

  const optionValue =
    optionMatch?.values?.find((value: Record<string, any>) =>
      typeof value?.value === "string"
    ) ?? null

  if (optionValue?.value) {
    return optionValue.value
  }

  for (const variant of product.variants ?? []) {
    for (const variantOption of variant?.options ?? []) {
      const optionTitle = toStringOrNull(
        variantOption?.option_title ?? variantOption?.option?.title
      )

      if (optionTitle?.toLowerCase() === "format") {
        const value = toStringOrNull(
          variantOption?.value ?? variantOption?.option_value?.value
        )
        if (value) {
          return value
        }
      }
    }
  }

  return null
}

const selectPrimaryVariant = (
  variants?: Array<Record<string, any>> | null
): Record<string, any> | null => {
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
  variant: Record<string, any> | null
): { amount: number | null; currency: string | null; compareAt: number | null } => {
  const prices = (variant?.prices ?? []).filter((price: Record<string, any>) =>
    typeof price?.amount === "number" && typeof price?.currency_code === "string"
  ) as Array<{ amount: number; currency_code: string; compare_at_amount?: number | null }>

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

const resolveStockStatus = (variant: Record<string, any> | null): {
  status: SearchDocument["stock_status"]
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

  if ((quantity ?? 0) <= 0) {
    return { status: "sold_out", quantity: quantity ?? 0 }
  }

  if ((quantity ?? 0) < 5) {
    return { status: "low_stock", quantity: quantity ?? 0 }
  }

  return { status: "in_stock", quantity: quantity ?? 0 }
}

const buildSearchDocument = (product: Record<string, any>): SearchDocument => {
  const normalizedProduct = product ?? {}
  const defaultVariant = selectPrimaryVariant(normalizedProduct.variants)

  const { amount, currency, compareAt } = pickPrice(defaultVariant)
  const { status, quantity } = resolveStockStatus(defaultVariant)

  const collection = normalizedProduct.collection as Record<string, any> | undefined
  const categories = Array.isArray(normalizedProduct.categories)
    ? (normalizedProduct.categories as Array<Record<string, any>>)
    : []

  const typeEntries = collectCategoryLabels(categories, TYPE_HANDLES)
  const genreEntries = collectCategoryLabels(categories, GENRE_HANDLES)
  const nonArtistEntries = collectNonArtistCategoryEntries(categories)

  const categoryTypes = Array.from(typeEntries.values())
  const categoryGenres = Array.from(genreEntries.values())
  const categoryHandles = Array.from(nonArtistEntries.keys())
  const categoryLabels = Array.from(nonArtistEntries.values())
  const metalGenres = collectMetalGenreLabels(categories)

  const variantTitlesSet = new Set<string>()
  for (const variant of normalizedProduct.variants ?? []) {
    const raw = toStringOrNull((variant as Record<string, any>)?.title)?.trim()
    if (raw) {
      variantTitlesSet.add(raw)
    }
  }
  const variantTitles: string[] = Array.from(variantTitlesSet)

  const genres =
    categoryGenres.length > 0 ? categoryGenres : getTagGenres(normalizedProduct.tags)
  const metadata = (normalizedProduct.metadata ??
    null) as Record<string, unknown> | null

  const legacyImport = (metadata?.legacy_import ??
    null) as Record<string, unknown> | null

  const productTypeRaw =
    (typeof legacyImport?.product_type === "string"
      ? legacyImport.product_type
      : null) ??
    (typeof metadata?.product_type === "string" ? metadata.product_type : null) ??
    null

  const productType =
    typeof productTypeRaw === "string" && productTypeRaw.trim().length
      ? productTypeRaw.trim()
      : null

  const subtitle = toStringOrNull(normalizedProduct.subtitle ?? null)
  const artistFromSubtitle =
    subtitle && subtitle.trim().length ? subtitle.trim() : null

  const artistFromMetadata =
    typeof metadata?.artist === "string" && metadata.artist.trim().length
      ? metadata.artist.trim()
      : null

  const format =
    categoryTypes.length > 0
      ? categoryTypes[0] ?? null
      : findFormatOption(normalizedProduct)

  return {
    id: normalizedProduct.id ?? "",
    handle: toStringOrNull(normalizedProduct.handle),
    title: toStringOrNull(normalizedProduct.title),
    description: toStringOrNull(
      (normalizedProduct as Record<string, unknown>).description ??
        (normalizedProduct as Record<string, unknown>).subtitle
    ),
    subtitle,
    artist: artistFromMetadata ?? artistFromSubtitle,
    thumbnail: getFirstImageUrl(normalizedProduct),
    collectionId: collection?.id ?? null,
    collectionTitle: collection?.title ?? null,
    collectionHandle: collection?.handle ?? null,
    genres,
    metalGenres,
    format,
    category_handles: categoryHandles,
    category_labels: categoryLabels,
    variant_titles: variantTitles,
    price_amount: amount,
    price_currency: currency,
    price_compare_at: compareAt ?? null,
    default_variant_id: defaultVariant?.id ?? null,
    default_variant_title: toStringOrNull(defaultVariant?.title),
    default_variant_sku: toStringOrNull(defaultVariant?.sku),
    inventory_quantity: quantity,
    stock_status: status,
    created_at: toStringOrNull(
      (normalizedProduct as Record<string, unknown>).created_at ??
        (normalizedProduct as Record<string, unknown>).createdAt
    ),
    updated_at: toStringOrNull(
      (normalizedProduct as Record<string, unknown>).updated_at ??
        (normalizedProduct as Record<string, unknown>).updatedAt
    ),
    product_type: productType,
    metadata:
      typeof metadata === "object" && metadata !== null
        ? metadata
        : null,
  }
}

const productSearchTransformer = (
  product: Record<string, unknown>,
  defaultTransformer: DefaultTransformer,
  options?: TransformerOptions
): SearchDocument => {
  const transformed = defaultTransformer(product, options) as Record<string, any>
  return buildSearchDocument(transformed)
}

export default productSearchTransformer
