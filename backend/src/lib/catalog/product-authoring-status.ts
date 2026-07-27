import { LOW_STOCK_THRESHOLD } from "./stock"

export const authoringInventoryStatuses = [
  "not_managed",
  "unknown",
  "sold_out",
  "low_stock",
  "in_stock",
] as const

export type AuthoringInventoryStatus =
  (typeof authoringInventoryStatuses)[number]

export const authoringCustomerStatuses = [
  "hidden",
  "coming_soon",
  "preorder",
  "backorder",
  "sold_out",
  "low_stock",
  "in_stock",
  "unknown",
] as const

export type AuthoringCustomerStatus =
  (typeof authoringCustomerStatuses)[number]

export type AuthoringVariantStatus = {
  customerStatus: AuthoringCustomerStatus
  inventoryQuantity: number | null
  inventoryStatus: AuthoringInventoryStatus
  reason: string
}

const inventoryStatus = ({
  inventoryQuantity,
  manageInventory,
}: {
  inventoryQuantity: number | null
  manageInventory: boolean
}): AuthoringInventoryStatus => {
  if (!manageInventory) {
    return "not_managed"
  }
  if (
    inventoryQuantity === null ||
    !Number.isFinite(inventoryQuantity)
  ) {
    return "unknown"
  }
  if (inventoryQuantity <= 0) {
    return "sold_out"
  }
  if (inventoryQuantity <= LOW_STOCK_THRESHOLD) {
    return "low_stock"
  }
  return "in_stock"
}

const futureTimestamp = (
  value: Date | string | null | undefined,
  now: number,
): boolean => {
  if (!value) {
    return false
  }
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(timestamp) && timestamp > now
}

export const resolveAuthoringVariantStatus = ({
  allowBackorder,
  inventoryQuantity,
  manageInventory,
  now = Date.now(),
  preorderAllowed,
  releaseDate,
  productStatus,
}: {
  allowBackorder: boolean
  inventoryQuantity: number | null
  manageInventory: boolean
  now?: number
  preorderAllowed: boolean
  productStatus: string | null
  releaseDate?: Date | string | null
}): AuthoringVariantStatus => {
  const stockStatus = inventoryStatus({
    inventoryQuantity,
    manageInventory,
  })

  if (productStatus !== "published") {
    return {
      customerStatus: "hidden",
      inventoryQuantity,
      inventoryStatus: stockStatus,
      reason: "The product is not published.",
    }
  }

  if (futureTimestamp(releaseDate, now)) {
    return preorderAllowed
      ? {
          customerStatus: "preorder",
          inventoryQuantity,
          inventoryStatus: stockStatus,
          reason: "The release date is in the future and preorders are enabled.",
        }
      : {
          customerStatus: "coming_soon",
          inventoryQuantity,
          inventoryStatus: stockStatus,
          reason: "The release date is in the future and preorders are disabled.",
        }
  }

  if (stockStatus === "not_managed") {
    return {
      customerStatus: "in_stock",
      inventoryQuantity,
      inventoryStatus: stockStatus,
      reason: "Medusa inventory tracking is disabled for this variant.",
    }
  }
  if (stockStatus === "unknown") {
    return {
      customerStatus: "unknown",
      inventoryQuantity: null,
      inventoryStatus: stockStatus,
      reason: "Managed inventory does not currently have a readable quantity.",
    }
  }
  if (stockStatus === "sold_out" && allowBackorder) {
    return {
      customerStatus: "backorder",
      inventoryQuantity,
      inventoryStatus: stockStatus,
      reason: "Stock is exhausted, but the native variant allows backorders.",
    }
  }
  if (stockStatus === "sold_out") {
    return {
      customerStatus: "sold_out",
      inventoryQuantity,
      inventoryStatus: stockStatus,
      reason: "The exact available inventory is zero.",
    }
  }
  if (stockStatus === "low_stock") {
    return {
      customerStatus: "low_stock",
      inventoryQuantity,
      inventoryStatus: stockStatus,
      reason: `Only ${inventoryQuantity} unit${inventoryQuantity === 1 ? "" : "s"} remain.`,
    }
  }

  return {
    customerStatus: "in_stock",
    inventoryQuantity,
    inventoryStatus: stockStatus,
    reason: `${inventoryQuantity} units are currently available.`,
  }
}
