import type {
  MedusaResponse,
  MedusaStoreRequest,
} from "@medusajs/framework/http"
import {
  getVariantAvailability,
  MedusaError,
  ProductStatus,
} from "@medusajs/framework/utils"

import { parseResolvedVariantMappings } from "@/lib/catalog/bundle-inventory"
import {
  readCatalogBundleComponents,
  readCatalogStoreBundleProfiles,
} from "@/lib/catalog/persistence-contracts"
import {
  readStoreBundleAvailability,
  readStoreBundleProducts,
} from "@/lib/catalog/store-bundle-contract"
import {
  listVisibleProductsByIds,
  readStoreProductCandidateIds,
  resolveStoreProductVisibility,
} from "@/lib/store-product-visibility"

type CatalogService = {
  listCatalogBundleProfiles: (
    filters: Record<string, unknown>
  ) => Promise<unknown>
  listCatalogBundleComponents: (
    filters: Record<string, unknown>
  ) => Promise<unknown>
}

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length ? value.trim() : null

const unique = (values: Array<string | null>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))))

const invalidStoreBundleProjection = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The Store bundle projection returned invalid structured data."
  )
}

export const GET = async (
  req: MedusaStoreRequest,
  res: MedusaResponse
): Promise<void> => {
  const handle = asString(req.params.handle)
  if (!handle || handle.length > 200) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A valid product handle is required"
    )
  }

  const { query, salesChannelIds } = resolveStoreProductVisibility(req)
  if (salesChannelIds.length !== 1 || !salesChannelIds[0]) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Bundle availability requires exactly one sales channel"
    )
  }

  const productCandidateResult = await query.graph({
    entity: "product",
    fields: ["id"],
    filters: { handle, status: ProductStatus.PUBLISHED },
    pagination: { take: 1 },
  })
  const productCandidateId = readStoreProductCandidateIds(
    productCandidateResult
  )[0]
  const rawProducts = productCandidateId
    ? await listVisibleProductsByIds({
        fields: [
          "id",
          "handle",
          "title",
          "variants.id",
          "variants.title",
          "variants.sku",
        ],
        productIds: [productCandidateId],
        query,
        salesChannelIds,
      })
    : []
  const [product] = readStoreBundleProducts(
    rawProducts,
    productCandidateId ? [productCandidateId] : []
  )
  const productId = product?.id
  if (!product || !productId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found")
  }

  const catalogService = req.scope.resolve<CatalogService>("catalog")
  const profiles = readCatalogStoreBundleProfiles(
    await catalogService.listCatalogBundleProfiles({
      product_id: productId,
    }),
    productId
  )
  const profile = profiles[0]
  if (!profile?.is_active) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Bundle composition not found"
    )
  }

  const componentsWithMappings = readCatalogBundleComponents(
    await catalogService.listCatalogBundleComponents({
      bundle_profile_id: profile.id,
    }),
    profile.id
  )
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((component) => ({
      component,
      mappings: parseResolvedVariantMappings(component, "persistence"),
    }))
  const componentProductIds = unique(
    componentsWithMappings.map(
      ({ component }) => component.component_product_id
    )
  )

  const rawComponentProducts = componentProductIds.length
    ? await listVisibleProductsByIds({
        fields: [
          "id",
          "handle",
          "title",
          "variants.id",
          "variants.title",
          "variants.sku",
        ],
        productIds: componentProductIds,
        query,
        salesChannelIds,
      })
    : []

  const componentProducts = readStoreBundleProducts(
    rawComponentProducts,
    componentProductIds
  )

  const componentProductsById = new Map(
    componentProducts.map((candidate) => [candidate.id, candidate])
  )
  const variantsByProductId = new Map(
    componentProducts.map((candidate) => [
      candidate.id,
      new Map(candidate.variants.map((variant) => [variant.id, variant])),
    ])
  )
  const bundleVariantTitles = new Map(
    product.variants.map((variant) => [variant.id, variant.title])
  )
  componentsWithMappings.forEach(({ mappings }) => {
    mappings.forEach((mapping) => {
      if (
        mapping.bundleVariantIds.some(
          (variantId) => !bundleVariantTitles.has(variantId)
        )
      ) {
        invalidStoreBundleProjection()
      }
    })
  })
  const visibleMappedVariantIds = unique(
    componentsWithMappings.flatMap(({ component, mappings }) =>
      mappings.flatMap((mapping) =>
        mapping.componentVariants.flatMap((variant) =>
          variantsByProductId
            .get(component.component_product_id)
            ?.has(variant.variantId)
            ? [variant.variantId]
            : []
        )
      )
    )
  )
  const rawAvailability = visibleMappedVariantIds.length
    ? await getVariantAvailability(
        query as Parameters<typeof getVariantAvailability>[0],
        {
          variant_ids: visibleMappedVariantIds,
          sales_channel_id: salesChannelIds[0],
        }
      )
    : {}
  const availability = readStoreBundleAvailability(
    rawAvailability,
    visibleMappedVariantIds
  )

  let unavailableMappingCount = 0
  const serializedComponents = componentsWithMappings.map(
    ({ component, mappings }, componentIndex) => {
      const quantity = component.quantity
      const componentProductId = component.component_product_id
      const componentProduct = componentProductsById.get(componentProductId)
      const componentVariants = variantsByProductId.get(componentProductId)
      const availabilityByBundleVariant = mappings.map((mapping) => {
        const options = mapping.componentVariants.flatMap((variant) => {
          const detail = componentVariants?.get(variant.variantId)
          if (!detail) {
            return []
          }
          const availableQuantity = availability[variant.variantId] ?? null
          return [
            {
              variantId: variant.variantId,
              title: detail.title,
              sku: detail.sku ?? variant.sku,
              availableQuantity,
              available:
                typeof availableQuantity === "number" &&
                availableQuantity >= quantity,
            },
          ]
        })
        const available =
          mapping.selectionMode === "any"
            ? options.some((option) => option.available)
            : options.length === mapping.componentVariants.length &&
              options.every((option) => option.available)
        if (!available) {
          unavailableMappingCount += 1
        }
        return {
          bundleVariantIds: mapping.bundleVariantIds,
          bundleVariantTitles: mapping.bundleVariantIds.map(
            (variantId) =>
              bundleVariantTitles.get(variantId) ??
              invalidStoreBundleProjection()
          ),
          selectionMode: mapping.selectionMode,
          available,
          options,
        }
      })

      return {
        id: component.id,
        title:
          component.title ??
          componentProduct?.title ??
          `Item ${componentIndex + 1}`,
        quantity,
        required: component.is_required,
        product: {
          id: componentProduct ? componentProductId : null,
          handle: componentProduct?.handle ?? null,
          title: componentProduct?.title ?? null,
        },
        availabilityByBundleVariant,
      }
    }
  )

  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=300, stale-while-revalidate=600"
  )
  res.setHeader("Vary", "x-publishable-api-key")
  res.status(200).json({
    bundle: {
      productId,
      handle: product.handle,
      title: profile.display_title ?? product.title,
      type: profile.bundle_type,
      componentCount: serializedComponents.length,
      unavailableMappingCount,
      hasUnavailableComponents: unavailableMappingCount > 0,
      components: serializedComponents,
    },
  })
}
