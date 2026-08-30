import type { MedusaStoreRequest } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  ProductStatus,
} from "@medusajs/framework/utils"

type JsonRecord = Record<string, unknown>
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
  }) => Promise<{ data: JsonRecord[] }>
}

export type StoreProductVisibilityContext = {
  query: StoreProductQueryGraph
  salesChannelIds: string[]
}

export const STORE_PRODUCT_PAGE_LIMIT = 100
export const STORE_PRODUCT_MAX_CANDIDATES = 3_000
const STORE_PRODUCT_MAX_SALES_CHANNELS = 8
const PRODUCT_LINK_CURSOR_PATTERN = /^prodsc_[a-zA-Z0-9]+$/u

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length ? value.trim() : null

const uniqueStrings = (values: readonly string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))

const assertBoundedCandidateIds = (productIds: readonly string[]): string[] => {
  const uniqueProductIds = uniqueStrings(productIds)
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
  const salesChannelIds = uniqueStrings(
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
    query: req.scope.resolve(
      ContainerRegistrationKeys.QUERY
    ) as StoreProductQueryGraph,
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

  const { data } = await query.graph({
    entity: "product",
    fields: [...fields],
    filters: {
      id: uniqueProductIds,
      status: ProductStatus.PUBLISHED,
    },
    pagination: { take: uniqueProductIds.length },
  })
  const byId = new Map(
    data.flatMap((product) => {
      const id = asString(product.id)
      return id ? [[id, product as T] as const] : []
    })
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
  const uniqueSalesChannelIds = uniqueStrings(salesChannelIds)
  if (!uniqueProductIds.length || !uniqueSalesChannelIds.length) {
    return []
  }

  const { data: links } = await query.graph({
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
    links
      .map((link) => asString(link.product_id))
      .filter((id): id is string => Boolean(id))
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
    sales_channel_id: uniqueStrings(salesChannelIds),
  }
  if (cursor) {
    linkFilters.id = {
      [direction === "ASC" ? "$gt" : "$lt"]: cursor,
    }
  }

  const { data: links } = await query.graph({
    entity: "product_sales_channel",
    fields: ["id", "product_id"],
    filters: linkFilters,
    pagination: {
      order: { id: direction },
      take: boundedLimit + 1,
    },
  })
  const pageLinks = links.slice(0, boundedLimit)
  const productIds = uniqueStrings(
    pageLinks.flatMap((link) => {
      const productId = asString(link.product_id)
      return productId ? [productId] : []
    })
  )
  const products = await listPublishedProductsByIds<T>({
    fields,
    productIds,
    query,
  })
  const lastLinkId = asString(pageLinks.at(-1)?.id)

  return {
    products,
    nextCursor: links.length > boundedLimit && lastLinkId ? lastLinkId : null,
  }
}
