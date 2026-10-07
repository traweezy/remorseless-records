import type { Context, IProductModuleService } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import {
  asUnknownRecord,
  readRecordArray,
} from "@/lib/provider-boundary/records"
import { selectActiveCatalogMedia } from "./media-presentation"
import { listProductMediaItems } from "./product-media-read"
import type { CatalogProductMediaMutationInput } from "./product-media-contract"
import type { CatalogService } from "./reference-resolution"
import { readCatalogMediaAssets } from "./transaction-persistence-contracts"

const MAX_VARIANTS = 100
type NativeThumbnail = { id: string; thumbnail: string | null }
export type NativeMediaProjectionPlan = {
  product: NativeThumbnail
  variants: NativeThumbnail[]
}
type ThumbnailChange = {
  id: string
  previous: string | null
  projected: string | null
}
export type NativeMediaProjectionSnapshot = {
  product: ThumbnailChange | null
  productId: string
  variants: ThumbnailChange[]
}

const invalid = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The native catalog media projection returned inconsistent data."
  )
}
const thumbnail = (value: unknown): string | null => {
  if (value === null) return null
  if (typeof value !== "string" || !value.length || value.length > 2_048)
    return invalid()
  try {
    if (!["http:", "https:"].includes(new URL(value).protocol)) invalid()
  } catch {
    invalid()
  }
  return value
}
const readNativeThumbnail = (
  value: unknown,
  expectedId: string
): NativeThumbnail => {
  const row = asUnknownRecord(value)
  if (!row || row.id !== expectedId || !Object.hasOwn(row, "thumbnail"))
    return invalid()
  return { id: expectedId, thumbnail: thumbnail(row.thumbnail) }
}

export const planNativeCatalogMediaProjection = async (
  products: IProductModuleService,
  catalog: CatalogService,
  input: Pick<CatalogProductMediaMutationInput, "aggregateId" | "media">
): Promise<NativeMediaProjectionPlan> => {
  const rows = readRecordArray(
    await products.listProducts(
      { id: [input.aggregateId] },
      { take: 2, select: ["id", "thumbnail"] }
    ),
    { context: "Native media Product" }
  )
  if (rows.length !== 1) invalid()
  const product = readNativeThumbnail(rows[0], input.aggregateId)
  const variantRows = readRecordArray(
    await products.listProductVariants(
      { product_id: input.aggregateId },
      { take: MAX_VARIANTS + 1, select: ["id", "product_id", "thumbnail"] }
    ),
    { context: "Native media Variants" }
  )
  if (variantRows.length > MAX_VARIANTS) invalid()
  const seen = new Set<string>()
  const variants = variantRows.map((row) => {
    if (
      typeof row.id !== "string" ||
      !/^variant_[A-Za-z0-9_-]+$/u.test(row.id) ||
      row.product_id !== product.id ||
      seen.has(row.id)
    )
      return invalid()
    seen.add(row.id)
    return readNativeThumbnail(row, row.id)
  })
  const previousMedia = await listProductMediaItems(catalog, product.id)
  if (
    [
      ...input.media.map((item) => item.variantId),
      ...previousMedia.map((item) => item.variant_id),
    ].some((id) => id != null && !seen.has(id))
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The selected media variant does not belong to this product."
    )
  }
  return { product, variants }
}

const assertEventGroup = (context: Context): void => {
  if (typeof context.eventGroupId !== "string" || !context.eventGroupId.length)
    invalid()
}

export const restoreNativeCatalogMediaProjection = async (
  products: IProductModuleService,
  snapshot: NativeMediaProjectionSnapshot,
  context: Context
): Promise<void> => {
  assertEventGroup(context)
  // Verify every owned field before restoring any of them. Unrelated native
  // edits are retained, and a changed thumbnail is a reconciliation conflict.
  for (const change of snapshot.variants) {
    const row = await products.retrieveProductVariant(change.id, {
      select: ["id", "product_id", "thumbnail"],
    })
    const current = readNativeThumbnail(row, change.id).thumbnail
    if (
      row.product_id !== snapshot.productId ||
      (current !== change.projected && current !== change.previous)
    )
      invalid()
  }
  if (snapshot.product) {
    const row = await products.retrieveProduct(snapshot.productId, {
      select: ["id", "thumbnail"],
    })
    const current = readNativeThumbnail(row, snapshot.productId).thumbnail
    if (
      current !== snapshot.product.projected &&
      current !== snapshot.product.previous
    )
      invalid()
  }
  for (const change of [...snapshot.variants].reverse()) {
    const current = readNativeThumbnail(
      await products.retrieveProductVariant(change.id, {
        select: ["id", "thumbnail"],
      }),
      change.id
    )
    if (current.thumbnail !== change.previous)
      await products.updateProductVariants(
        change.id,
        { thumbnail: change.previous },
        context
      )
  }
  if (snapshot.product) {
    const current = readNativeThumbnail(
      await products.retrieveProduct(snapshot.productId, {
        select: ["id", "thumbnail"],
      }),
      snapshot.productId
    )
    if (current.thumbnail !== snapshot.product.previous)
      await products.updateProducts(
        snapshot.productId,
        { thumbnail: snapshot.product.previous },
        context
      )
  }
}

export const projectNativeCatalogMedia = async (
  products: IProductModuleService,
  catalog: CatalogService,
  plan: NativeMediaProjectionPlan,
  context: Context
): Promise<NativeMediaProjectionSnapshot> => {
  assertEventGroup(context)
  const productId = plan.product.id
  const items = await listProductMediaItems(catalog, productId)
  if (
    items.some(
      (item) =>
        item.variant_id !== null &&
        !plan.variants.some(({ id }) => id === item.variant_id)
    )
  )
    invalid()
  const assetIds = [...new Set(items.map((item) => item.media_asset_id))]
  const assets = assetIds.length
    ? readCatalogMediaAssets(
        await catalog.listCatalogMediaAssets(
          { id: assetIds },
          { take: assetIds.length + 1 }
        ),
        {
          expectedIds: assetIds,
          maximumRows: assetIds.length,
          requireExactIds: true,
        }
      )
    : []
  const media = selectActiveCatalogMedia(items, assets)
  const desiredProduct = media[0]?.asset.source_url ?? null
  const snapshot: NativeMediaProjectionSnapshot = {
    product: null,
    productId,
    variants: [],
  }
  const changes = plan.variants
    .map(
      (variant): ThumbnailChange => ({
        id: variant.id,
        previous: variant.thumbnail,
        projected:
          media.find(({ item }) => item.variant_id === variant.id)?.asset
            .source_url ?? null,
      })
    )
    .filter((change) => change.previous !== change.projected)

  const currentProduct = readNativeThumbnail(
    await products.retrieveProduct(productId, { select: ["id", "thumbnail"] }),
    productId
  )
  if (currentProduct.thumbnail !== plan.product.thumbnail) invalid()
  for (const variant of plan.variants) {
    const current = await products.retrieveProductVariant(variant.id, {
      select: ["id", "product_id", "thumbnail"],
    })
    if (
      current.product_id !== productId ||
      readNativeThumbnail(current, variant.id).thumbnail !== variant.thumbnail
    )
      invalid()
  }
  try {
    if (plan.product.thumbnail !== desiredProduct) {
      snapshot.product = {
        id: productId,
        previous: plan.product.thumbnail,
        projected: desiredProduct,
      }
      await products.updateProducts(
        productId,
        { thumbnail: desiredProduct },
        context
      )
    }
    for (const change of changes) {
      snapshot.variants.push(change)
      await products.updateProductVariants(
        change.id,
        { thumbnail: change.projected },
        context
      )
    }
    if (
      readNativeThumbnail(
        await products.retrieveProduct(productId, {
          select: ["id", "thumbnail"],
        }),
        productId
      ).thumbnail !== desiredProduct
    )
      invalid()
    for (const change of changes) {
      if (
        readNativeThumbnail(
          await products.retrieveProductVariant(change.id, {
            select: ["id", "thumbnail"],
          }),
          change.id
        ).thumbnail !== change.projected
      )
        invalid()
    }
  } catch (error) {
    // A step that throws before StepResponse has no persisted compensation
    // payload. Restore its completed native writes before propagating failure.
    await restoreNativeCatalogMediaProjection(products, snapshot, context)
    throw error
  }
  return snapshot
}
