import type { HttpTypes } from "@medusajs/types"

import { asUnknownRecord } from "@/lib/provider-boundary"

type StoreProduct = HttpTypes.StoreProduct

const isOptionalString = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === "string"

const isOptionalRecord = (value: unknown): boolean =>
  value === undefined || value === null || asUnknownRecord(value) !== null

const isBoundedRecordArray = (
  value: unknown,
  maximum: number,
  validate: (record: Record<string, unknown>) => boolean
): boolean =>
  value === undefined ||
  value === null ||
  (Array.isArray(value) &&
    value.length <= maximum &&
    value.every((entry) => {
      const record = asUnknownRecord(entry)
      return record !== null && validate(record)
    }))

const isStoreProduct = (value: unknown): value is StoreProduct => {
  const product = asUnknownRecord(value)
  if (!product) {
    return false
  }

  return (
    typeof product.id === "string" &&
    product.id.trim().length > 0 &&
    product.id.length <= 200 &&
    typeof product.handle === "string" &&
    product.handle.trim().length > 0 &&
    product.handle.length <= 200 &&
    isOptionalString(product.title) &&
    isOptionalString(product.subtitle) &&
    isOptionalString(product.description) &&
    isOptionalString(product.thumbnail) &&
    isOptionalString(product.created_at) &&
    isOptionalRecord(product.metadata) &&
    isOptionalRecord(product.collection) &&
    isBoundedRecordArray(product.images, 100, (image) =>
      isOptionalString(image.url)
    ) &&
    isBoundedRecordArray(product.tags, 100, (tag) =>
      isOptionalString(tag.value)
    ) &&
    isBoundedRecordArray(product.categories, 100, (category) =>
      isOptionalString(category.id)
    ) &&
    isBoundedRecordArray(product.options, 100, (option) =>
      isOptionalString(option.title)
    ) &&
    isBoundedRecordArray(
      product.variants,
      200,
      (variant) =>
        typeof variant.id === "string" &&
        variant.id.trim().length > 0 &&
        variant.id.length <= 200 &&
        isOptionalString(variant.title) &&
        isOptionalString(variant.sku) &&
        isOptionalString(variant.stock_status) &&
        (variant.inventory_quantity === undefined ||
          variant.inventory_quantity === null ||
          (typeof variant.inventory_quantity === "number" &&
            Number.isFinite(variant.inventory_quantity))) &&
        (variant.manage_inventory === undefined ||
          typeof variant.manage_inventory === "boolean") &&
        (variant.allow_backorder === undefined ||
          typeof variant.allow_backorder === "boolean") &&
        isOptionalRecord(variant.metadata) &&
        isOptionalRecord(variant.calculated_price)
    )
  )
}

export type StoreProductListProjection = {
  products: StoreProduct[]
  count: number
}

export const readStoreProductListResponse = (
  value: unknown,
  maximum: number = 200
): StoreProductListProjection => {
  const response = asUnknownRecord(value)
  if (
    !response ||
    !Array.isArray(response.products) ||
    response.products.length > maximum ||
    response.products.some((product) => !isStoreProduct(product))
  ) {
    throw new Error("Store product response is invalid")
  }

  const products = response.products.filter(isStoreProduct)
  const ids = products.map((product) => product.id)
  const handles = products.map((product) => product.handle)
  if (
    new Set(ids).size !== ids.length ||
    new Set(handles).size !== handles.length
  ) {
    throw new Error("Store product response contains duplicate products")
  }

  const count = response.count
  if (
    count !== undefined &&
    (typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < products.length ||
      count > 1_000_000)
  ) {
    throw new Error("Store product response count is invalid")
  }
  return {
    products,
    count: typeof count === "number" ? count : products.length,
  }
}

export const readStoreProductDetailResponse = (
  value: unknown
): StoreProduct => {
  const response = asUnknownRecord(value)
  if (!response) {
    throw new Error("Store product detail response is invalid")
  }
  const product = readStoreProductListResponse(
    { products: [response.product] },
    1
  ).products[0]
  if (!product) {
    throw new Error("Store product detail response is missing its product")
  }
  return product
}
