import {
  ContainerRegistrationKeys,
  getTotalVariantAvailability,
  MedusaError,
} from "@medusajs/framework/utils"

import type CatalogModuleService from "../../modules/catalog/service"
import {
  serializeCatalogArtist,
  serializeCatalogBundleComponent,
  serializeCatalogBundleProfile,
  serializeCatalogProductArtist,
  serializeCatalogProductProfile,
  serializeCatalogProductReference,
  serializeCatalogReferenceValue,
  serializeCatalogVariantProfile,
  type CatalogArtistRecord,
  type CatalogBundleComponentRecord,
  type CatalogBundleProfileRecord,
  type CatalogProductArtistRecord,
  type CatalogProductProfileRecord,
  type CatalogProductReferenceRecord,
  type CatalogReferenceValueRecord,
  type CatalogVariantProfileRecord,
} from "../../modules/catalog/serializers"
import {
  readCatalogArtistList,
  readCatalogProductArtists,
  readCatalogProductProfiles,
  readCatalogProductReferences,
  readCatalogReferenceValueList,
  readCatalogVariantProfileList,
} from "./profile-persistence-contracts"
import {
  readCatalogBundleComponentStates,
  readCatalogBundleStateProfiles,
} from "./transaction-persistence-contracts"
import {
  buildCatalogAuthoringAudit,
  type CatalogAuthoringAuditItem,
} from "./authoring-audit"
import {
  resolveAuthoringVariantStatus,
  type AuthoringVariantStatus,
} from "./product-authoring-status"
import { loadProductMediaResponse } from "./product-media-read"

type CatalogService = InstanceType<typeof CatalogModuleService>
type DynamicRecord = Record<string, unknown>

type QueryGraph = Parameters<typeof getTotalVariantAvailability>[0]

type ServiceContainer = {
  resolve: <T = unknown>(key: string) => T
}

export type ProductAuthoringPrice = {
  amount: number
  currencyCode: string
  id: string
  maxQuantity: number | null
  minQuantity: number | null
}

export type ProductAuthoringVariantOption = {
  id: string
  optionId: string | null
  optionTitle: string | null
  value: string
}

export type ProductAuthoringCommerceVariant = {
  allowBackorder: boolean
  barcode: string | null
  ean: string | null
  id: string
  manageInventory: boolean
  metadata: DynamicRecord
  options: ProductAuthoringVariantOption[]
  prices: ProductAuthoringPrice[]
  rank: number
  sku: string | null
  title: string
  upc: string | null
}

export type ProductAuthoringCommerceProduct = {
  collection: {
    handle: string | null
    id: string
    title: string
  } | null
  createdAt: string | null
  description: string | null
  discountable: boolean
  handle: string | null
  id: string
  images: Array<{
    id: string
    rank: number
    url: string
  }>
  metadata: DynamicRecord
  options: Array<{
    id: string
    title: string
    values: Array<{
      id: string
      value: string
    }>
  }>
  status: string | null
  subtitle: string | null
  thumbnail: string | null
  title: string
  type: {
    id: string
    value: string
  } | null
  updatedAt: string | null
  variants: ProductAuthoringCommerceVariant[]
}

export type ProductAuthoringView = {
  catalog: {
    artists: Array<{
      artist: ReturnType<typeof serializeCatalogArtist> | null
      assignment: ReturnType<typeof serializeCatalogProductArtist>
    }>
    bundle: {
      components: Array<ReturnType<typeof serializeCatalogBundleComponent>>
      profile: ReturnType<typeof serializeCatalogBundleProfile>
    } | null
    label: ReturnType<typeof serializeCatalogReferenceValue> | null
    media: Awaited<ReturnType<typeof loadProductMediaResponse>>["media"]
    profile: ReturnType<typeof serializeCatalogProductProfile> | null
    productType: ReturnType<typeof serializeCatalogReferenceValue> | null
    references: Array<{
      assignment: ReturnType<typeof serializeCatalogProductReference>
      value: ReturnType<typeof serializeCatalogReferenceValue> | null
    }>
    variants: Array<{
      format: ReturnType<typeof serializeCatalogReferenceValue> | null
      formatDetail: ReturnType<typeof serializeCatalogReferenceValue> | null
      profile: ReturnType<typeof serializeCatalogVariantProfile> | null
      status: AuthoringVariantStatus
      variantId: string
    }>
  }
  classification: CatalogAuthoringAuditItem
  commerce: ProductAuthoringCommerceProduct
  diagnostics: {
    duplicateBundleProfileIds: string[]
    duplicateProductProfileIds: string[]
    inventoryAvailability: "available" | "unavailable"
    missingArtistIds: string[]
    missingMediaAssetIds: string[]
    missingReferenceValueIds: string[]
    missingVariantProfileIds: string[]
    orphanVariantProfileIds: string[]
  }
}

type ProductAuthoringViewSource = {
  artistAssignments: CatalogProductArtistRecord[]
  artists: CatalogArtistRecord[]
  availabilityByVariantId: Record<string, number | null>
  availabilityLoaded: boolean
  bundleComponents: CatalogBundleComponentRecord[]
  bundleProfiles: CatalogBundleProfileRecord[]
  media: Awaited<ReturnType<typeof loadProductMediaResponse>>["media"]
  product: DynamicRecord
  productProfiles: CatalogProductProfileRecord[]
  referenceAssignments: CatalogProductReferenceRecord[]
  referenceValues: CatalogReferenceValueRecord[]
  variantProfiles: CatalogVariantProfileRecord[]
}

const toRecord = (value: unknown): DynamicRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as DynamicRecord)
    : {}

const toRecordOrNull = (value: unknown): DynamicRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as DynamicRecord)
    : null

const toRecords = (value: unknown): DynamicRecord[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is DynamicRecord =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry))
      )
    : []

const toText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length ? value.trim() : null

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const toBoolean = (value: unknown): boolean => value === true

const toIso = (value: unknown): string | null => {
  if (!value) {
    return null
  }
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

const mapPrice = (price: DynamicRecord): ProductAuthoringPrice | null => {
  const id = toText(price.id)
  const currencyCode = toText(price.currency_code)
  const amount = toNumber(price.amount)
  if (!id || !currencyCode || amount === null) {
    return null
  }
  return {
    amount,
    currencyCode,
    id,
    maxQuantity: toNumber(price.max_quantity),
    minQuantity: toNumber(price.min_quantity),
  }
}

const mapVariantOption = (
  option: DynamicRecord
): ProductAuthoringVariantOption | null => {
  const id = toText(option.id)
  const value = toText(option.value)
  if (!id || !value) {
    return null
  }
  const definition = toRecordOrNull(option.option)
  return {
    id,
    optionId:
      toText(option.option_id) ??
      toText(option.optionId) ??
      toText(definition?.id),
    optionTitle:
      toText(option.option_title) ??
      toText(option.optionTitle) ??
      toText(definition?.title),
    value,
  }
}

const mapVariant = (
  variant: DynamicRecord
): ProductAuthoringCommerceVariant | null => {
  const id = toText(variant.id)
  if (!id) {
    return null
  }
  return {
    allowBackorder: toBoolean(
      variant.allow_backorder ?? variant.allowBackorder
    ),
    barcode: toText(variant.barcode),
    ean: toText(variant.ean),
    id,
    manageInventory: toBoolean(
      variant.manage_inventory ?? variant.manageInventory
    ),
    metadata: toRecord(variant.metadata),
    options: toRecords(variant.options)
      .map(mapVariantOption)
      .filter((option): option is ProductAuthoringVariantOption =>
        Boolean(option)
      ),
    prices: toRecords(variant.prices)
      .map(mapPrice)
      .filter((price): price is ProductAuthoringPrice => Boolean(price)),
    rank: toNumber(variant.variant_rank ?? variant.rank) ?? 0,
    sku: toText(variant.sku),
    title: toText(variant.title) ?? "Untitled variant",
    upc: toText(variant.upc),
  }
}

const mapCommerceProduct = (
  product: DynamicRecord
): ProductAuthoringCommerceProduct => {
  const id = toText(product.id)
  if (!id) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The product authoring query returned a product without an id."
    )
  }
  const type = toRecordOrNull(product.type)
  const typeId = toText(type?.id)
  const typeValue = toText(type?.value)
  const collection = toRecordOrNull(product.collection)
  const collectionId = toText(collection?.id)
  const collectionTitle = toText(collection?.title)

  return {
    collection:
      collectionId && collectionTitle
        ? {
            handle: toText(collection?.handle),
            id: collectionId,
            title: collectionTitle,
          }
        : null,
    createdAt: toIso(product.created_at),
    description: toText(product.description),
    discountable: product.discountable !== false,
    handle: toText(product.handle),
    id,
    images: toRecords(product.images)
      .map((image) => {
        const imageId = toText(image.id)
        const url = toText(image.url)
        return imageId && url
          ? {
              id: imageId,
              rank: toNumber(image.rank) ?? 0,
              url,
            }
          : null
      })
      .filter(
        (
          image
        ): image is {
          id: string
          rank: number
          url: string
        } => Boolean(image)
      )
      .sort((left, right) => left.rank - right.rank),
    metadata: toRecord(product.metadata),
    options: toRecords(product.options).flatMap((option) => {
      const optionId = toText(option.id)
      const title = toText(option.title)
      if (!optionId || !title) {
        return []
      }
      return [
        {
          id: optionId,
          title,
          values: toRecords(option.values).flatMap((value) => {
            const valueId = toText(value.id)
            const label = toText(value.value)
            return valueId && label ? [{ id: valueId, value: label }] : []
          }),
        },
      ]
    }),
    status: toText(product.status),
    subtitle: toText(product.subtitle),
    thumbnail: toText(product.thumbnail),
    title: toText(product.title) ?? "Untitled product",
    type:
      typeId && typeValue
        ? {
            id: typeId,
            value: typeValue,
          }
        : null,
    updatedAt: toIso(product.updated_at),
    variants: toRecords(product.variants)
      .map(mapVariant)
      .filter((variant): variant is ProductAuthoringCommerceVariant =>
        Boolean(variant)
      )
      .sort((left, right) => left.rank - right.rank),
  }
}

const unique = (values: Array<string | null | undefined>): string[] => [
  ...new Set(values.filter((value): value is string => Boolean(value))),
]

export const buildProductAuthoringView = (
  source: ProductAuthoringViewSource
): ProductAuthoringView => {
  const commerce = mapCommerceProduct(source.product)
  const productProfile = source.productProfiles.at(0) ?? null
  const bundleProfile = source.bundleProfiles.at(0) ?? null
  const artistsById = new Map(
    source.artists.map((artist) => [artist.id, artist])
  )
  const referencesById = new Map(
    source.referenceValues.map((reference) => [reference.id, reference])
  )
  const variantProfilesById = new Map(
    source.variantProfiles.map((profile) => [profile.variant_id, profile])
  )
  const nativeVariantIds = new Set(
    commerce.variants.map((variant) => variant.id)
  )
  const releaseDate = productProfile?.release_date ?? null

  const classification = buildCatalogAuthoringAudit({
    bundles: source.bundleProfiles.map((profile) => ({
      bundleType: String(profile.bundle_type),
      productId: profile.product_id,
    })),
    products: [
      {
        handle: commerce.handle,
        id: commerce.id,
        metadata: commerce.metadata,
        nativeProductType: commerce.type?.value ?? null,
        status: commerce.status,
        title: commerce.title,
      },
    ],
    profiles: source.productProfiles.map((profile) => ({
      productId: profile.product_id,
      productTypeId: profile.product_type_id ?? null,
    })),
    references: source.referenceValues.map((reference) => ({
      id: reference.id,
      isActive: reference.is_active,
      kind: String(reference.kind),
      label: reference.label,
      value: reference.value,
    })),
  }).items[0]

  if (!classification) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The product authoring classification could not be generated."
    )
  }

  const missingArtistIds = unique(
    source.artistAssignments.map(({ artist_id }) =>
      artist_id && !artistsById.has(artist_id) ? artist_id : null
    )
  )
  const selectedReferenceIds = unique([
    productProfile?.label_id,
    productProfile?.product_type_id,
    ...source.referenceAssignments.map(
      ({ reference_value_id }) => reference_value_id
    ),
    ...source.variantProfiles.flatMap(({ format_id, format_detail_id }) => [
      format_id,
      format_detail_id,
    ]),
  ])
  const missingReferenceValueIds = selectedReferenceIds.filter(
    (id) => !referencesById.has(id)
  )

  return {
    catalog: {
      artists: source.artistAssignments.map((assignment) => {
        const artist = assignment.artist_id
          ? artistsById.get(assignment.artist_id)
          : undefined
        return {
          artist: artist ? serializeCatalogArtist(artist) : null,
          assignment: serializeCatalogProductArtist(assignment),
        }
      }),
      bundle: bundleProfile
        ? {
            components: source.bundleComponents.map(
              serializeCatalogBundleComponent
            ),
            profile: serializeCatalogBundleProfile(bundleProfile),
          }
        : null,
      label:
        productProfile?.label_id && referencesById.has(productProfile.label_id)
          ? serializeCatalogReferenceValue(
              referencesById.get(productProfile.label_id)!
            )
          : null,
      media: source.media,
      profile: productProfile
        ? serializeCatalogProductProfile(productProfile)
        : null,
      productType:
        productProfile?.product_type_id &&
        referencesById.has(productProfile.product_type_id)
          ? serializeCatalogReferenceValue(
              referencesById.get(productProfile.product_type_id)!
            )
          : null,
      references: source.referenceAssignments.map((assignment) => ({
        assignment: serializeCatalogProductReference(assignment),
        value: referencesById.has(assignment.reference_value_id)
          ? serializeCatalogReferenceValue(
              referencesById.get(assignment.reference_value_id)!
            )
          : null,
      })),
      variants: commerce.variants.map((variant) => {
        const profile = variantProfilesById.get(variant.id) ?? null
        return {
          format:
            profile?.format_id && referencesById.has(profile.format_id)
              ? serializeCatalogReferenceValue(
                  referencesById.get(profile.format_id)!
                )
              : null,
          formatDetail:
            profile?.format_detail_id &&
            referencesById.has(profile.format_detail_id)
              ? serializeCatalogReferenceValue(
                  referencesById.get(profile.format_detail_id)!
                )
              : null,
          profile: profile ? serializeCatalogVariantProfile(profile) : null,
          status: resolveAuthoringVariantStatus({
            allowBackorder: variant.allowBackorder,
            inventoryQuantity:
              source.availabilityByVariantId[variant.id] ?? null,
            manageInventory: variant.manageInventory,
            preorderAllowed: profile?.preorder_allowed ?? false,
            productStatus: commerce.status,
            releaseDate: profile?.preorder_release_date ?? releaseDate,
          }),
          variantId: variant.id,
        }
      }),
    },
    classification,
    commerce,
    diagnostics: {
      duplicateBundleProfileIds: source.bundleProfiles
        .slice(1)
        .map(({ id }) => id),
      duplicateProductProfileIds: source.productProfiles
        .slice(1)
        .map(({ id }) => id),
      inventoryAvailability: source.availabilityLoaded
        ? "available"
        : "unavailable",
      missingArtistIds,
      missingMediaAssetIds: source.media
        .filter(({ asset }) => asset === null)
        .map(({ mediaAssetId }) => mediaAssetId),
      missingReferenceValueIds,
      missingVariantProfileIds: commerce.variants
        .filter(({ id }) => !variantProfilesById.has(id))
        .map(({ id }) => id),
      orphanVariantProfileIds: source.variantProfiles
        .filter(({ variant_id }) => !nativeVariantIds.has(variant_id))
        .map(({ id }) => id),
    },
  }
}

const productFields = [
  "id",
  "title",
  "handle",
  "status",
  "description",
  "subtitle",
  "thumbnail",
  "discountable",
  "metadata",
  "created_at",
  "updated_at",
  "type.*",
  "collection.*",
  "images.*",
  "options.*",
  "options.values.*",
  "variants.*",
  "variants.prices.*",
  "variants.options.*",
  "variants.options.option.*",
]

const loadAvailability = async (
  query: QueryGraph,
  variantIds: string[]
): Promise<{
  availabilityByVariantId: Record<string, number | null>
  availabilityLoaded: boolean
}> => {
  if (!variantIds.length) {
    return {
      availabilityByVariantId: {},
      availabilityLoaded: true,
    }
  }
  try {
    const availability = await getTotalVariantAvailability(query, {
      variant_ids: variantIds,
    })
    return {
      availabilityByVariantId: Object.fromEntries(
        variantIds.map((variantId) => [
          variantId,
          availability[variantId]?.availability ?? null,
        ])
      ),
      availabilityLoaded: true,
    }
  } catch {
    return {
      availabilityByVariantId: Object.fromEntries(
        variantIds.map((variantId) => [variantId, null])
      ),
      availabilityLoaded: false,
    }
  }
}

export const loadProductAuthoringView = async (
  container: ServiceContainer,
  productId: string
): Promise<ProductAuthoringView> => {
  const query = container.resolve<QueryGraph>(ContainerRegistrationKeys.QUERY)
  const catalogService = container.resolve<CatalogService>("catalog")
  const { data } = await query.graph({
    entity: "product",
    fields: productFields,
    filters: { id: [productId] },
  })
  const product = data.at(0)
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found.")
  }

  const commerce = mapCommerceProduct(product)
  const variantIds = commerce.variants.map(({ id }) => id)
  const [productProfiles, bundleProfiles, mediaResponse, availabilityResult] =
    await Promise.all([
      catalogService
        .listCatalogProductProfiles({ product_id: productId }, { take: 2 })
        .then((value) => readCatalogProductProfiles(value, productId)),
      catalogService
        .listCatalogBundleProfiles({ product_id: productId }, { take: 2 })
        .then((value) => readCatalogBundleStateProfiles(value, productId)),
      loadProductMediaResponse(catalogService, productId),
      loadAvailability(query, variantIds),
    ])
  if (!availabilityResult.availabilityLoaded) {
    const logger = container.resolve<{
      warn: (message: string) => void
    }>(ContainerRegistrationKeys.LOGGER)
    logger.warn(
      `[catalog-authoring-view] Inventory availability is unavailable for ${productId}.`
    )
  }
  const productProfile = productProfiles.at(0)
  const bundleProfile = bundleProfiles.at(0)

  const [
    artistAssignments,
    referenceAssignments,
    variantProfiles,
    bundleComponents,
  ] = await Promise.all([
    productProfile
      ? catalogService
          .listCatalogProductArtists(
            { product_profile_id: productProfile.id },
            { order: { id: "ASC", sort_order: "ASC" }, take: 101 }
          )
          .then((value) => readCatalogProductArtists(value, productProfile.id))
      : Promise.resolve([]),
    productProfile
      ? catalogService
          .listCatalogProductReferences(
            { product_profile_id: productProfile.id },
            { order: { id: "ASC", sort_order: "ASC" }, take: 101 }
          )
          .then((value) =>
            readCatalogProductReferences(value, productProfile.id)
          )
      : Promise.resolve([]),
    variantIds.length
      ? catalogService
          .listCatalogVariantProfiles(
            { variant_id: variantIds },
            { take: variantIds.length + 1 }
          )
          .then((value) => readCatalogVariantProfileList(value, variantIds))
      : Promise.resolve([]),
    bundleProfile
      ? catalogService
          .listCatalogBundleComponents(
            { bundle_profile_id: bundleProfile.id },
            { order: { id: "ASC", sort_order: "ASC" }, take: 101 }
          )
          .then((value) =>
            readCatalogBundleComponentStates(value, bundleProfile.id, 100)
          )
      : Promise.resolve([]),
  ])

  const artistIds = unique(artistAssignments.map(({ artist_id }) => artist_id))
  const referenceIds = unique([
    productProfile?.label_id,
    productProfile?.product_type_id,
    ...referenceAssignments.map(({ reference_value_id }) => reference_value_id),
    ...variantProfiles.flatMap(({ format_id, format_detail_id }) => [
      format_id,
      format_detail_id,
    ]),
  ])
  const [artists, referenceValues] = await Promise.all([
    artistIds.length
      ? catalogService
          .listCatalogArtists({ id: artistIds }, { take: artistIds.length + 1 })
          .then((value) =>
            readCatalogArtistList(value, {
              expectedIds: artistIds,
              maximumRows: artistIds.length,
            })
          )
      : Promise.resolve([]),
    referenceIds.length
      ? catalogService
          .listCatalogReferenceValues(
            { id: referenceIds },
            { take: referenceIds.length + 1 }
          )
          .then((value) =>
            readCatalogReferenceValueList(value, {
              expectedIds: referenceIds,
              maximumRows: referenceIds.length,
            })
          )
      : Promise.resolve([]),
  ])

  return buildProductAuthoringView({
    artistAssignments,
    artists,
    availabilityByVariantId: availabilityResult.availabilityByVariantId,
    availabilityLoaded: availabilityResult.availabilityLoaded,
    bundleComponents,
    bundleProfiles,
    media: mediaResponse.media,
    product,
    productProfiles,
    referenceAssignments,
    referenceValues,
    variantProfiles,
  })
}
