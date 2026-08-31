import type {
  CreateProductWorkflowInputDTO,
  InventoryTypes,
  MedusaContainer,
  ProductTypes,
} from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"

import type { CatalogBundleMutationInput } from "../../modules/catalog/bundle-authoring"
import {
  deriveCatalogCommandIdempotencyKey,
  hashCatalogCommand,
} from "../../modules/catalog/catalog-command"
import { coerceCatalogJsonRecord, slugifyCatalogValue } from "./normalization"
import {
  readCatalogCreatedProductId,
  readCatalogCreatedProductVariants,
  readCatalogEntityIds,
  readCatalogServiceIds,
  readCatalogStoreDefaults,
  readCatalogVariantInventoryLinks,
  readCatalogVariantOwnerships,
} from "./persistence-contracts"
import type { CatalogProductCreateCommandInput } from "./product-create-authoring"
import type { CatalogProductProfileMutationInput } from "./product-profile-contract"
import type { CatalogProductMediaMutationInput } from "./product-media-contract"

const DEFAULT_STOCK_LOCATION_NAME = "HQ"
const CREATION_VARIANT_KEY = "catalog_creation_variant_key"

type QueryGraph = {
  graph: (query: {
    entity: string
    fields: string[]
    filters?: Record<string, unknown>
    pagination?: { take?: number; skip?: number }
  }) => Promise<unknown>
}

type FulfillmentService = {
  listShippingProfiles: (filters: Record<string, unknown>) => Promise<unknown>
}

type StoreService = {
  listStores: () => Promise<unknown>
}

export type CatalogProductCreateComponent =
  CatalogBundleMutationInput["components"][number] & {
    bundleVariantKeys: string[] | null
  }

export type CatalogProductCreateContext = {
  bundleComponents: CatalogProductCreateComponent[]
  salesChannelId: string
  shippingProfileId: string
  stockLocationId: string
}

export type CatalogProductCreateVariantTarget = {
  definition: CatalogProductCreateCommandInput["variants"][number]
  variantId: string
}

export type CatalogCreatedProduct = {
  productId: string
  targets: CatalogProductCreateVariantTarget[]
}

const resolveBundleComponents = async (
  query: QueryGraph,
  input: CatalogProductCreateCommandInput
): Promise<CatalogProductCreateComponent[]> => {
  const components = input.bundle?.components ?? []
  if (input.kind !== "fixed_bundle" || !components.length) {
    return []
  }

  const variantIds = components.map((component) => component.componentVariantId)
  const [variantResult, linkResult] = await Promise.all([
    query.graph({
      entity: "product_variant",
      fields: ["id", "product_id", "product.id"],
      filters: { id: variantIds },
    }),
    query.graph({
      entity: "product_variant_inventory_items",
      fields: ["variant_id", "inventory_item_id"],
      filters: { variant_id: variantIds },
    }),
  ])
  const variantsById = new Map(
    readCatalogVariantOwnerships(variantResult, variantIds).map((variant) => [
      variant.id,
      variant,
    ])
  )
  const inventoryByVariantId = new Map<string, string[]>()
  readCatalogVariantInventoryLinks(linkResult, variantIds).forEach((link) => {
    inventoryByVariantId.set(link.variantId, [
      ...(inventoryByVariantId.get(link.variantId) ?? []),
      link.inventoryItemId,
    ])
  })

  return components.map((component, index) => {
    const variant = variantsById.get(component.componentVariantId)
    if (!variant) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Bundle component variant ${component.componentVariantId} was not found.`
      )
    }
    if (variant.productId !== component.componentProductId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Bundle component variant ${component.componentVariantId} does not belong to its selected product.`
      )
    }
    const inventoryItemIds = Array.from(
      new Set(inventoryByVariantId.get(component.componentVariantId) ?? [])
    )
    if (inventoryItemIds.length !== 1 || !inventoryItemIds[0]) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Bundle component variant ${component.componentVariantId} must resolve to exactly one inventory item.`
      )
    }
    return {
      bundleVariantKeys: component.bundleVariantKeys ?? null,
      component_inventory_item_id: inventoryItemIds[0],
      component_product_id: component.componentProductId,
      component_variant_id: component.componentVariantId,
      is_required: component.isRequired,
      metadata: coerceCatalogJsonRecord(component.metadata),
      quantity: component.quantity,
      sku: component.sku?.trim() || null,
      sort_order: component.sortOrder ?? index,
      title: component.title?.trim() || null,
      variant_title: component.variantTitle?.trim() || null,
    }
  })
}

export const resolveCatalogProductCreateContext = async (
  container: MedusaContainer,
  input: CatalogProductCreateCommandInput
): Promise<CatalogProductCreateContext> => {
  const fulfillmentService = container.resolve<FulfillmentService>(
    Modules.FULFILLMENT
  )
  const storeService = container.resolve<StoreService>(Modules.STORE)
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const stockLocationName =
    process.env.SHIPPING_STOCK_LOCATION_NAME?.trim() ||
    DEFAULT_STOCK_LOCATION_NAME
  const [rawShippingProfiles, rawStores, stockLocationResult] =
    await Promise.all([
      fulfillmentService.listShippingProfiles({ type: "default" }),
      storeService.listStores(),
      query.graph({
        entity: "stock_location",
        fields: ["id", "name"],
        filters: { name: stockLocationName },
      }),
    ])
  const shippingProfileIds = readCatalogServiceIds(rawShippingProfiles)
  const stores = readCatalogStoreDefaults(rawStores)
  const stockLocationIds = readCatalogEntityIds(stockLocationResult)

  if (shippingProfileIds.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Catalog creation requires exactly one default shipping profile; found ${shippingProfileIds.length}.`
    )
  }
  const storesWithSalesChannel = stores.filter(
    (store) => store.defaultSalesChannelId !== null
  )
  if (storesWithSalesChannel.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Catalog creation requires exactly one store with a default sales channel; found ${storesWithSalesChannel.length}.`
    )
  }
  const salesChannelId = storesWithSalesChannel[0]?.defaultSalesChannelId
  if (!salesChannelId) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The store default sales channel is unavailable."
    )
  }
  if (stockLocationIds.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Catalog creation requires exactly one ${stockLocationName} stock location; found ${stockLocationIds.length}.`
    )
  }

  return {
    bundleComponents: await resolveBundleComponents(query, input),
    salesChannelId,
    shippingProfileId: shippingProfileIds[0]!,
    stockLocationId: stockLocationIds[0]!,
  }
}

export const buildCatalogNativeProduct = (
  input: CatalogProductCreateCommandInput,
  context: CatalogProductCreateContext
): CreateProductWorkflowInputDTO => ({
  description: input.description?.trim() || null,
  handle: input.handle ?? slugifyCatalogValue(input.title, "draft-product"),
  metadata: {
    ...coerceCatalogJsonRecord(input.metadata),
    authoring_kind: input.kind,
  },
  options: input.options.map((option) => ({
    title: option.title,
    values: option.values,
  })),
  sales_channels: [{ id: context.salesChannelId }],
  shipping_profile_id: context.shippingProfileId,
  status: ProductStatus.DRAFT,
  title: input.title,
  variants: input.variants.map((variant) => ({
    allow_backorder: variant.allowBackorder ?? false,
    manage_inventory: input.kind !== "fixed_bundle",
    metadata: { [CREATION_VARIANT_KEY]: variant.key },
    options: variant.options,
    prices: variant.prices.map((price) => ({
      amount: price.amount,
      currency_code: price.currencyCode,
    })),
    sku: variant.sku,
    title: variant.title,
  })),
})

export const resolveCatalogCreatedProduct = async (
  container: MedusaContainer,
  input: CatalogProductCreateCommandInput,
  products: ProductTypes.ProductDTO[]
): Promise<CatalogCreatedProduct> => {
  const productId = readCatalogCreatedProductId(products)
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const result = await query.graph({
    entity: "product",
    fields: ["id", "variants.id", "variants.metadata"],
    filters: { id: productId },
    pagination: { take: 1 },
  })
  const variants = readCatalogCreatedProductVariants(
    result,
    productId,
    input.variants.map((variant) => variant.key),
    CREATION_VARIANT_KEY
  )
  const variantIdsByKey = new Map(
    variants.map((variant) => [variant.creationKey, variant.id])
  )
  const targets = input.variants.map((definition) => {
    const variantId = variantIdsByKey.get(definition.key)
    if (!variantId) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Created product variant ${definition.key} could not be resolved.`
      )
    }
    return { definition, variantId }
  })
  return { productId, targets }
}

const defaultProductTypeLabel = (
  kind: CatalogProductCreateCommandInput["kind"]
): string | null => {
  if (kind === "music_release") {
    return "Music release"
  }
  if (kind === "fixed_bundle") {
    return "Fixed bundle"
  }
  if (kind === "mystery_bundle") {
    return "Mystery bundle"
  }
  return null
}

export const buildCatalogProductProfileMutation = (
  input: CatalogProductCreateCommandInput,
  productId: string
): CatalogProductProfileMutationInput => {
  const fallbackProductType = defaultProductTypeLabel(input.kind)
  const patch = {
    ...input.profile,
    descriptionHtml:
      input.profile.descriptionHtml ?? input.description ?? undefined,
    metadata: {
      ...coerceCatalogJsonRecord(input.profile.metadata),
      authoring_kind: input.kind,
    },
    productType:
      input.profile.productType ??
      (input.profile.productTypeId || !fallbackProductType
        ? undefined
        : { label: fallbackProductType }),
    releaseTitle: input.profile.releaseTitle ?? input.title,
  }
  const commandPayload = {
    aggregateId: productId,
    command: "catalog.product-profile.upsert" as const,
    expectedVersion: 0,
    patch,
  }
  return {
    ...commandPayload,
    actorId: input.actorId,
    idempotencyKey: deriveCatalogCommandIdempotencyKey(
      input.idempotencyKey,
      "product-profile"
    ),
    requestSha256: hashCatalogCommand(commandPayload),
  }
}

export const buildCatalogProductMediaMutation = (
  input: CatalogProductCreateCommandInput,
  productId: string,
  productProfileId: string
): CatalogProductMediaMutationInput => {
  const media = input.media.map((item) => ({
    altText: item.altText,
    isPrimary: item.isPrimary,
    mediaAssetId: item.mediaAssetId,
    productProfileId,
    role: item.role,
    sortOrder: item.sortOrder,
  }))
  const commandPayload = {
    aggregateId: productId,
    command: "catalog.product-media.replace" as const,
    expectedVersion: 0,
    media,
  }
  return {
    ...commandPayload,
    actorId: input.actorId,
    idempotencyKey: deriveCatalogCommandIdempotencyKey(
      input.idempotencyKey,
      "product-media"
    ),
    requestSha256: hashCatalogCommand(commandPayload),
  }
}

export const buildCatalogBundleMutation = (
  input: CatalogProductCreateCommandInput,
  context: CatalogProductCreateContext,
  created: CatalogCreatedProduct,
  productId: string,
  productProfileId: string
): CatalogBundleMutationInput => {
  const mystery = input.kind === "mystery_bundle"
  const profile = {
    bundle_type: mystery ? ("mystery" as const) : ("fixed" as const),
    description_html:
      input.bundle?.descriptionHtml ?? input.description ?? null,
    display_title: input.bundle?.displayTitle ?? input.title,
    fulfillment_mode: mystery
      ? ("manual" as const)
      : ("ship_components" as const),
    inventory_mode: mystery
      ? ("manual" as const)
      : ("component_derived" as const),
    is_active: true,
    metadata: coerceCatalogJsonRecord(input.bundle?.metadata),
    product_id: productId,
    product_profile_id: productProfileId,
  }
  const bundleVariantIdsByKey = new Map(
    created.targets.map((target) => [
      target.definition.key.toLocaleLowerCase(),
      target.variantId,
    ])
  )
  const components = mystery
    ? []
    : context.bundleComponents.map(({ bundleVariantKeys, ...component }) => ({
        ...component,
        metadata: bundleVariantKeys
          ? {
              ...component.metadata,
              resolved_variant_mappings: [
                {
                  bundle_variant_ids: bundleVariantKeys.map((key) => {
                    const variantId = bundleVariantIdsByKey.get(
                      key.toLocaleLowerCase()
                    )
                    if (!variantId) {
                      throw new MedusaError(
                        MedusaError.Types.UNEXPECTED_STATE,
                        `Bundle variant mapping ${key} could not be resolved.`
                      )
                    }
                    return variantId
                  }),
                  component_variants: [
                    {
                      inventory_item_id: component.component_inventory_item_id,
                      sku: component.sku,
                      variant_id: component.component_variant_id,
                    },
                  ],
                  selection_mode: "exact",
                },
              ],
            }
          : component.metadata,
      }))
  const commandPayload = {
    aggregateId: productId,
    command: "catalog.bundle.upsert" as const,
    components,
    expectedVersion: 0,
    profile,
  }
  return {
    ...commandPayload,
    actorId: input.actorId,
    idempotencyKey: deriveCatalogCommandIdempotencyKey(
      input.idempotencyKey,
      "bundle"
    ),
    requestSha256: hashCatalogCommand(commandPayload),
  }
}

export const resolveCatalogProductInventoryLevels = async (
  container: MedusaContainer,
  input: CatalogProductCreateCommandInput,
  context: CatalogProductCreateContext,
  created: CatalogCreatedProduct
): Promise<InventoryTypes.CreateInventoryLevelInput[]> => {
  if (input.kind === "fixed_bundle") {
    return []
  }
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const variantIds = created.targets.map((target) => target.variantId)
  const result = await query.graph({
    entity: "product_variant_inventory_items",
    fields: ["variant_id", "inventory_item_id"],
    filters: { variant_id: variantIds },
  })
  const inventoryByVariantId = new Map<string, string[]>()
  readCatalogVariantInventoryLinks(result, variantIds).forEach((link) => {
    inventoryByVariantId.set(link.variantId, [
      ...(inventoryByVariantId.get(link.variantId) ?? []),
      link.inventoryItemId,
    ])
  })

  return created.targets.map((target) => {
    const inventoryItemIds = Array.from(
      new Set(inventoryByVariantId.get(target.variantId) ?? [])
    )
    if (inventoryItemIds.length !== 1 || !inventoryItemIds[0]) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Created variant ${target.definition.key} must resolve to exactly one managed inventory item.`
      )
    }
    return {
      inventory_item_id: inventoryItemIds[0],
      location_id: context.stockLocationId,
      stocked_quantity: target.definition.stockQuantity ?? 0,
    }
  })
}
