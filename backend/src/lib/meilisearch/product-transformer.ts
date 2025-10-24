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
  thumbnail: string | null
  collectionId: string | null
  collectionTitle: string | null
  collectionHandle: string | null
  genres: string[]
  format: string | null
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

const getGenres = (tags?: Array<Record<string, any>> | null): string[] => {
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

  return {
    id: normalizedProduct.id ?? "",
    handle: toStringOrNull(normalizedProduct.handle),
    title: toStringOrNull(normalizedProduct.title),
    description: toStringOrNull(
      (normalizedProduct as Record<string, unknown>).description ??
        (normalizedProduct as Record<string, unknown>).subtitle
    ),
    thumbnail: getFirstImageUrl(normalizedProduct),
    collectionId: collection?.id ?? null,
    collectionTitle: collection?.title ?? null,
    collectionHandle: collection?.handle ?? null,
    genres: getGenres(normalizedProduct.tags),
    format: findFormatOption(normalizedProduct),
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
    metadata:
      typeof normalizedProduct.metadata === "object" && normalizedProduct.metadata !== null
        ? normalizedProduct.metadata
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
