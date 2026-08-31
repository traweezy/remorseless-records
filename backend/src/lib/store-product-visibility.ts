import type { MedusaStoreRequest } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  ProductStatus,
} from "@medusajs/framework/utils"

import {
  readProviderDataRecords,
  type UnknownRecord,
} from "./provider-boundary/records"

type JsonRecord = UnknownRecord
type QueryPagination = {
  order?: Record<string, "ASC" | "DESC">
  skip?: number
  take?: number
}

export type StoreProductQueryGraph = {
  graph: (query: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: QueryPagination
  }) => Promise<unknown>
}

export type StoreProductVisibilityContext = {
  query: StoreProductQueryGraph
  salesChannelIds: string[]
}

export const STORE_PRODUCT_PAGE_LIMIT = 100
export const STORE_PRODUCT_MAX_CANDIDATES = 3_000
const STORE_PRODUCT_MAX_SALES_CHANNELS = 8
const PRODUCT_LINK_CURSOR_PATTERN = /^prodsc_[a-zA-Z0-9]+$/u
const STORE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,254}$/u

const invalidStoreProductData = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The Store product query returned invalid structured data."
  )
}

const asStoreIdentifier = (value: unknown): string | null =>
  typeof value === "string" &&
  value.length > 0 &&
  value === value.trim() &&
  STORE_IDENTIFIER_PATTERN.test(value)
    ? value
    : null

const requiredStoreIdentifier = (value: unknown): string =>
  asStoreIdentifier(value) ?? invalidStoreProductData()

const readStoreGraphRows = (value: unknown): JsonRecord[] => {
  try {
    return readProviderDataRecords(value, "Store product query")
  } catch {
    return invalidStoreProductData()
  }
}

const uniqueIdentifiers = (values: readonly string[]): string[] => {
  if (values.some((value) => !asStoreIdentifier(value))) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Store product identifiers are invalid"
    )
  }
  return Array.from(new Set(values))
}

export const readStoreProductCandidateIds = (value: unknown): string[] => {
  const rows = readStoreGraphRows(value)
  if (rows.length > 1) {
    return invalidStoreProductData()
  }
  return rows.map((row) => requiredStoreIdentifier(row.id))
}

const readStoreProductRows = <T extends JsonRecord>(
  value: unknown,
  expectedProductIds: readonly string[]
): T[] => {
  const expected = new Set(expectedProductIds)
  const seen = new Set<string>()
  return readStoreGraphRows(value).map((row) => {
    const id = requiredStoreIdentifier(row.id)
    if (!expected.has(id) || seen.has(id)) {
      return invalidStoreProductData()
    }
    seen.add(id)
    return row as T
  })
}

const readStoreVisibilityLinks = (
  value: unknown,
  expectedProductIds: readonly string[]
): string[] => {
  const expected = new Set(expectedProductIds)
  return readStoreGraphRows(value).map((row) => {
    const productId = requiredStoreIdentifier(row.product_id)
    return expected.has(productId) ? productId : invalidStoreProductData()
  })
}

type StoreProductPageLink = {
  id: string
  productId: string
}

const readStoreProductPageLinks = (
  value: unknown,
  input: {
    cursor?: string
    direction: "ASC" | "DESC"
    maximumRows: number
  }
): StoreProductPageLink[] => {
  const rows = readStoreGraphRows(value)
  if (rows.length > input.maximumRows) {
    return invalidStoreProductData()
  }
  const seen = new Set<string>()
  const links = rows.map((row) => {
    const id = requiredStoreIdentifier(row.id)
    const productId = requiredStoreIdentifier(row.product_id)
    if (!PRODUCT_LINK_CURSOR_PATTERN.test(id) || seen.has(id)) {
      return invalidStoreProductData()
    }
    seen.add(id)
    return { id, productId }
  })
  links.forEach((link, index) => {
    const previousId = index === 0 ? input.cursor : links[index - 1]?.id
    if (
      previousId &&
      (input.direction === "ASC"
        ? link.id <= previousId
        : link.id >= previousId)
    ) {
      invalidStoreProductData()
    }
  })
  return links
}

const assertBoundedCandidateIds = (productIds: readonly string[]): string[] => {
  const uniqueProductIds = uniqueIdentifiers(productIds)
  if (uniqueProductIds.length > STORE_PRODUCT_MAX_CANDIDATES) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Product visibility checks are limited to ${STORE_PRODUCT_MAX_CANDIDATES} candidates`
    )
  }
  return uniqueProductIds
}

export const resolveStoreProductVisibility = (
  req: MedusaStoreRequest
): StoreProductVisibilityContext => {
  const salesChannelIds = uniqueIdentifiers(
    req.publishable_key_context?.sales_channel_ids ?? []
  )
  if (!salesChannelIds.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "A publishable key with a sales channel is required"
    )
  }
  if (salesChannelIds.length > STORE_PRODUCT_MAX_SALES_CHANNELS) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The publishable key has too many sales channels"
    )
  }

  return {
    query: req.scope.resolve<StoreProductQueryGraph>(
      ContainerRegistrationKeys.QUERY
    ),
    salesChannelIds,
  }
}

const listPublishedProductsByIds = async <T extends JsonRecord>({
  fields,
  productIds,
  query,
}: {
  fields: readonly string[]
  productIds: readonly string[]
  query: StoreProductQueryGraph
}): Promise<T[]> => {
  const uniqueProductIds = assertBoundedCandidateIds(productIds)
  if (!uniqueProductIds.length) {
    return []
  }

  const result = await query.graph({
    entity: "product",
    fields: [...fields],
    filters: {
      id: uniqueProductIds,
      status: ProductStatus.PUBLISHED,
    },
    pagination: { take: uniqueProductIds.length },
  })
  const products = readStoreProductRows<T>(result, uniqueProductIds)
  const byId = new Map(
    products.map((product) => [requiredStoreIdentifier(product.id), product])
  )

  return uniqueProductIds.flatMap((id) => {
    const product = byId.get(id)
    return product ? [product] : []
  })
}

export const listVisibleProductsByIds = async <T extends JsonRecord>({
  fields,
  productIds,
  query,
  salesChannelIds,
}: {
  fields: readonly string[]
  productIds: readonly string[]
  query: StoreProductQueryGraph
  salesChannelIds: readonly string[]
}): Promise<T[]> => {
  const uniqueProductIds = assertBoundedCandidateIds(productIds)
  const uniqueSalesChannelIds = uniqueIdentifiers(salesChannelIds)
  if (!uniqueProductIds.length || !uniqueSalesChannelIds.length) {
    return []
  }

  const linkResult = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id"],
    filters: {
      product_id: uniqueProductIds,
      sales_channel_id: uniqueSalesChannelIds,
    },
    pagination: {
      take: uniqueProductIds.length * uniqueSalesChannelIds.length,
    },
  })
  const linkedProductIds = new Set(
    readStoreVisibilityLinks(linkResult, uniqueProductIds)
  )
  const visibleProductIds = uniqueProductIds.filter((id) =>
    linkedProductIds.has(id)
  )

  return listPublishedProductsByIds<T>({
    fields,
    productIds: visibleProductIds,
    query,
  })
}

export const encodeStoreProductCursor = (linkId: string): string => {
  if (!PRODUCT_LINK_CURSOR_PATTERN.test(linkId)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid product page cursor"
    )
  }
  return Buffer.from(linkId, "utf8").toString("base64url")
}

export const decodeStoreProductCursor = (
  cursor: string | undefined
): string | undefined => {
  if (!cursor) {
    return undefined
  }
  if (!/^[a-zA-Z0-9_-]{1,256}$/u.test(cursor)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid product page cursor"
    )
  }

  const decoded = Buffer.from(cursor, "base64url").toString("utf8")
  const canonical = Buffer.from(decoded, "utf8").toString("base64url")
  if (canonical !== cursor || !PRODUCT_LINK_CURSOR_PATTERN.test(decoded)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid product page cursor"
    )
  }
  return decoded
}

export const listVisibleProductPage = async <T extends JsonRecord>({
  cursor,
  direction = "ASC",
  fields,
  limit,
  query,
  salesChannelIds,
}: {
  cursor?: string
  direction?: "ASC" | "DESC"
  fields: readonly string[]
  limit: number
  query: StoreProductQueryGraph
  salesChannelIds: readonly string[]
}): Promise<{ nextCursor: string | null; products: T[] }> => {
  const boundedLimit = Math.min(
    Math.max(Math.trunc(limit), 1),
    STORE_PRODUCT_PAGE_LIMIT
  )
  const linkFilters: Record<string, unknown> = {
    sales_channel_id: uniqueIdentifiers(salesChannelIds),
  }
  if (cursor) {
    linkFilters.id = {
      [direction === "ASC" ? "$gt" : "$lt"]: cursor,
    }
  }

  const linkResult = await query.graph({
    entity: "product_sales_channel",
    fields: ["id", "product_id"],
    filters: linkFilters,
    pagination: {
      order: { id: direction },
      take: boundedLimit + 1,
    },
  })
  const links = readStoreProductPageLinks(linkResult, {
    ...(cursor ? { cursor } : {}),
    direction,
    maximumRows: boundedLimit + 1,
  })
  const pageLinks = links.slice(0, boundedLimit)
  const productIds = Array.from(
    new Set(pageLinks.map((link) => link.productId))
  )
  const products = await listPublishedProductsByIds<T>({
    fields,
    productIds,
    query,
  })
  const lastLinkId = pageLinks.at(-1)?.id ?? null

  return {
    products,
    nextCursor: links.length > boundedLimit ? lastLinkId : null,
  }
}
