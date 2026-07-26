import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import type { Context } from "@medusajs/framework/types"
import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import { sanitizeRichTextHtml } from "@/lib/content/rich-text"
import { hashCatalogCommand } from "@/modules/catalog/catalog-command"
import {
  catalogReleaseDatePrecisionValues,
  catalogReferenceKindValues,
  serializeCatalogProductArtist,
  serializeCatalogProductProfile,
  serializeCatalogProductReference,
  type CatalogReferenceKind,
} from "@/modules/catalog/serializers"
import {
  assertProductExists,
  coerceJsonList,
  coerceJsonRecord,
  createOrReuseArtist,
  createOrReuseReferenceValue,
  firstResult,
  normalizeList,
  toNullableString,
  toOptionalDate,
  toOptionalInteger,
  type CatalogService,
} from "../../../utils"

const referenceInputSchema = z.object({
  referenceValueId: z.string().trim().optional().nullable(),
  kind: z.enum(catalogReferenceKindValues).optional().nullable(),
  label: z.string().trim().optional().nullable(),
  value: z.string().trim().optional().nullable(),
  sortOrder: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const namedReferenceInputSchema = z.object({
  referenceValueId: z.string().trim().optional().nullable(),
  label: z.string().trim().optional().nullable(),
  value: z.string().trim().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const artistInputSchema = z.object({
  artistId: z.string().trim().optional().nullable(),
  name: z.string().trim().optional().nullable(),
  displayName: z.string().trim().optional().nullable(),
  role: z.string().trim().optional(),
  sortOrder: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const profileUpsertSchema = z.object({
  idempotencyKey: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
  releaseTitle: z.string().trim().optional().nullable(),
  labelId: z.string().trim().optional().nullable(),
  label: namedReferenceInputSchema.optional().nullable(),
  productTypeId: z.string().trim().optional().nullable(),
  productType: namedReferenceInputSchema.optional().nullable(),
  releaseDate: z.string().trim().optional().nullable(),
  releaseYear: z.number().int().min(1900).max(2200).optional().nullable(),
  releaseDatePrecision: z.enum(catalogReleaseDatePrecisionValues).optional(),
  descriptionHtml: z.string().optional().nullable(),
  searchKeywords: z.array(z.string().trim()).optional(),
  tracklist: z.array(z.unknown()).optional(),
  credits: z.record(z.string(), z.unknown()).optional(),
  pressingNotes: z.record(z.string(), z.unknown()).optional(),
  merchDetails: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  artists: z.array(artistInputSchema).optional(),
  references: z.array(referenceInputSchema).optional(),
})

const toReferenceKind = (value: unknown): CatalogReferenceKind => {
  const match = catalogReferenceKindValues.find((kind) => kind === value)
  return match ?? "utility_tag"
}

const resolveProfile = async (
  catalogService: CatalogService,
  productId: string,
  sharedContext?: Context<EntityManager>
) => {
  const profiles = await catalogService.listCatalogProductProfiles(
    {
      product_id: productId,
    },
    {},
    sharedContext
  )
  return profiles.at(0) ?? null
}

const loadProfileRelations = async (
  catalogService: CatalogService,
  profileId: string,
  sharedContext?: Context<EntityManager>
) => {
  const [artists, references] = await Promise.all([
    catalogService.listCatalogProductArtists(
      { product_profile_id: profileId },
      { order: { sort_order: "ASC" } },
      sharedContext
    ),
    catalogService.listCatalogProductReferences(
      { product_profile_id: profileId },
      { order: { sort_order: "ASC" } },
      sharedContext
    ),
  ])

  return {
    artists: artists.map(serializeCatalogProductArtist),
    references: references.map(serializeCatalogProductReference),
  }
}

const serializeProfileResponse = async (
  catalogService: CatalogService,
  profile: NonNullable<Awaited<ReturnType<typeof resolveProfile>>> | null
) => {
  if (!profile) {
    return {
      profile: null,
      artists: [],
      references: [],
    }
  }

  return {
    profile: serializeCatalogProductProfile(profile),
    ...(await loadProfileRelations(catalogService, profile.id)),
  }
}

const deleteProfileRelations = async (
  catalogService: CatalogService,
  profileId: string,
  relation: "artists" | "references",
  sharedContext?: Context<EntityManager>
): Promise<void> => {
  if (relation === "artists") {
    const existing = await catalogService.listCatalogProductArtists(
      {
        product_profile_id: profileId,
      },
      {},
      sharedContext
    )
    const ids = existing.map((artist) => artist.id)
    if (ids.length) {
      await catalogService.deleteCatalogProductArtists(ids, sharedContext)
    }
    return
  }

  const existing = await catalogService.listCatalogProductReferences(
    {
      product_profile_id: profileId,
    },
    {},
    sharedContext
  )
  const ids = existing.map((reference) => reference.id)
  if (ids.length) {
    await catalogService.deleteCatalogProductReferences(ids, sharedContext)
  }
}

const resolveNamedReferenceId = async (
  catalogService: CatalogService,
  input: {
    id?: string | null | undefined
    kind: Extract<CatalogReferenceKind, "label" | "product_type">
    reference?: z.infer<typeof namedReferenceInputSchema> | null | undefined
  },
  sharedContext?: Context<EntityManager>
): Promise<string | null | undefined> => {
  if (input.id === null || input.reference === null) {
    return null
  }

  const referenceValueId = toNullableString(input.id)
  if (referenceValueId) {
    return referenceValueId
  }

  if (!input.reference) {
    return undefined
  }

  const value = await createOrReuseReferenceValue(catalogService, {
    referenceValueId: input.reference.referenceValueId,
    kind: input.kind,
    label: input.reference.label,
    value: input.reference.value,
    metadata: coerceJsonRecord(input.reference.metadata),
  }, sharedContext)

  return value?.id ?? null
}

const upsertArtists = async (
  catalogService: CatalogService,
  profileId: string,
  artists: z.infer<typeof artistInputSchema>[],
  sharedContext?: Context<EntityManager>
): Promise<void> => {
  await deleteProfileRelations(
    catalogService,
    profileId,
    "artists",
    sharedContext
  )

  const payloads = []
  for (const [index, input] of artists.entries()) {
    const artist = await createOrReuseArtist(catalogService, {
      artistId: input.artistId,
      name: input.name ?? input.displayName,
      metadata: coerceJsonRecord(input.metadata),
    }, sharedContext)
    const displayName =
      toNullableString(input.displayName) ??
      artist?.name ??
      toNullableString(input.name)

    if (!displayName) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Each product artist requires an artistId, name, or displayName"
      )
    }

    payloads.push({
      product_profile_id: profileId,
      artist_id: artist?.id ?? null,
      display_name: displayName,
      role: toNullableString(input.role) ?? "primary",
      sort_order: input.sortOrder ?? index,
      metadata: coerceJsonRecord(input.metadata),
    })
  }

  if (payloads.length) {
    await catalogService.createCatalogProductArtists(payloads, sharedContext)
  }
}

const upsertReferences = async (
  catalogService: CatalogService,
  profileId: string,
  references: z.infer<typeof referenceInputSchema>[],
  sharedContext?: Context<EntityManager>
): Promise<void> => {
  await deleteProfileRelations(
    catalogService,
    profileId,
    "references",
    sharedContext
  )

  const payloads = []
  for (const [index, input] of references.entries()) {
    const reference = await createOrReuseReferenceValue(catalogService, {
      referenceValueId: input.referenceValueId,
      kind: input.kind,
      label: input.label,
      value: input.value,
      metadata: coerceJsonRecord(input.metadata),
    }, sharedContext)

    if (!reference) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Each product reference requires a referenceValueId or kind and label"
      )
    }

    payloads.push({
      product_profile_id: profileId,
      reference_value_id: reference.id,
      kind: toReferenceKind(reference.kind),
      sort_order: input.sortOrder ?? index,
      metadata: coerceJsonRecord(input.metadata),
    })
  }

  if (payloads.length) {
    await catalogService.createCatalogProductReferences(
      payloads,
      sharedContext
    )
  }
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const productId = req.params.product_id
  if (!productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product id is required"
    )
  }

  await assertProductExists(req, productId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const profile = await resolveProfile(catalogService, productId)
  res.status(200).json(await serializeProfileResponse(catalogService, profile))
}

export const PUT = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const productId = req.params.product_id
  if (!productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product id is required"
    )
  }

  const parsed = profileUpsertSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid catalog product profile payload"
    )
  }

  await assertProductExists(req, productId)
  const catalogService = req.scope.resolve("catalog") as CatalogService
  const actorId =
    (
      req as MedusaRequest & {
        auth_context?: { actor_id?: string | null }
      }
    ).auth_context?.actor_id ?? null
  const { idempotencyKey, ...commandData } = parsed.data
  const requestSha256 = hashCatalogCommand({
    command: "catalog.product-profile.upsert",
    productId,
    input: commandData,
  })
  const transactionResult = await catalogService.runCatalogTransaction(
    async (sharedContext) => {
      const existingOperation = (
        await catalogService.listCatalogAuthoringOperations(
          { idempotency_key: idempotencyKey },
          { take: 1 },
          sharedContext
        )
      )[0]
      if (existingOperation) {
        const matches =
          existingOperation.command === "catalog.product-profile.upsert" &&
          existingOperation.aggregate_id === productId &&
          existingOperation.actor_id === actorId &&
          existingOperation.expected_version === parsed.data.expectedVersion &&
          existingOperation.request_sha256 === requestSha256
        if (!matches || existingOperation.status !== "succeeded") {
          throw new MedusaError(
            MedusaError.Types.CONFLICT,
            "The catalog idempotency key cannot be replayed for this product profile command."
          )
        }
        return { created: false }
      }

      const existing = await resolveProfile(
        catalogService,
        productId,
        sharedContext
      )
      const currentVersion = existing?.version ?? 0
      if (currentVersion !== parsed.data.expectedVersion) {
        throw new MedusaError(
          MedusaError.Types.CONFLICT,
          "The product profile changed after it was loaded. Refresh before saving."
        )
      }

      const [operation] = await catalogService.createCatalogAuthoringOperations(
        [
          {
            idempotency_key: idempotencyKey,
            command: "catalog.product-profile.upsert",
            aggregate_id: productId,
            actor_id: actorId,
            request_sha256: requestSha256,
            expected_version: parsed.data.expectedVersion,
            status: "pending",
            result: {},
            metadata: {},
          },
        ],
        sharedContext
      )
      if (!operation) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "The product profile command audit record was not created."
        )
      }

      const labelId = await resolveNamedReferenceId(
        catalogService,
        {
          id: parsed.data.labelId,
          kind: "label",
          reference: parsed.data.label,
        },
        sharedContext
      )
      const productTypeId = await resolveNamedReferenceId(
        catalogService,
        {
          id: parsed.data.productTypeId,
          kind: "product_type",
          reference: parsed.data.productType,
        },
        sharedContext
      )
      const payload: Record<string, unknown> = {
        product_id: productId,
        version: currentVersion + 1,
      }

      if (parsed.data.releaseTitle !== undefined) {
        payload.release_title = toNullableString(parsed.data.releaseTitle)
      }
      if (labelId !== undefined) {
        payload.label_id = labelId
      }
      if (productTypeId !== undefined) {
        payload.product_type_id = productTypeId
      }
      if (parsed.data.releaseDate !== undefined) {
        payload.release_date = toOptionalDate(parsed.data.releaseDate)
      }
      if (parsed.data.releaseYear !== undefined) {
        payload.release_year = toOptionalInteger(parsed.data.releaseYear)
      }
      if (parsed.data.releaseDatePrecision !== undefined) {
        payload.release_date_precision = parsed.data.releaseDatePrecision
      } else if (
        parsed.data.releaseDate !== undefined ||
        parsed.data.releaseYear !== undefined ||
        !existing
      ) {
        payload.release_date_precision = parsed.data.releaseDate
          ? "day"
          : parsed.data.releaseYear
            ? "year"
            : "unknown"
      }
      if (parsed.data.descriptionHtml !== undefined) {
        const description = toNullableString(parsed.data.descriptionHtml)
        payload.description_html = description
          ? sanitizeRichTextHtml(description)
          : null
      }
      if (parsed.data.searchKeywords !== undefined) {
        payload.search_keywords = normalizeList(parsed.data.searchKeywords)
      }
      if (parsed.data.tracklist !== undefined) {
        payload.tracklist = coerceJsonList(parsed.data.tracklist)
      }
      if (parsed.data.credits !== undefined) {
        payload.credits = coerceJsonRecord(parsed.data.credits)
      }
      if (parsed.data.pressingNotes !== undefined) {
        payload.pressing_notes = coerceJsonRecord(parsed.data.pressingNotes)
      }
      if (parsed.data.merchDetails !== undefined) {
        payload.merch_details = coerceJsonRecord(parsed.data.merchDetails)
      }
      if (parsed.data.metadata !== undefined) {
        payload.metadata = coerceJsonRecord(parsed.data.metadata)
      }

      const savedResult = existing
        ? await catalogService.updateCatalogProductProfiles(
            [
              {
                id: existing.id,
                ...payload,
              },
            ],
            sharedContext
          )
        : await catalogService.createCatalogProductProfiles(
            [payload],
            sharedContext
          )
      const saved = firstResult(savedResult)
      if (!saved) {
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          "Unable to save catalog product profile"
        )
      }

      if (parsed.data.artists !== undefined) {
        await upsertArtists(
          catalogService,
          saved.id,
          parsed.data.artists,
          sharedContext
        )
      }
      if (parsed.data.references !== undefined) {
        await upsertReferences(
          catalogService,
          saved.id,
          parsed.data.references,
          sharedContext
        )
      }
      await catalogService.completeCatalogAuthoringOperation(
        operation.id,
        {
          productId,
          profileId: saved.id,
          version: currentVersion + 1,
        },
        sharedContext
      )
      return { created: !existing }
    }
  )

  const refreshed = await resolveProfile(catalogService, productId)
  res.status(transactionResult.created ? 201 : 200).json(
    await serializeProfileResponse(catalogService, refreshed)
  )
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> => {
  const productId = req.params.product_id
  if (!productId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product id is required"
    )
  }

  const catalogService = req.scope.resolve("catalog") as CatalogService
  await catalogService.runCatalogTransaction(async (sharedContext) => {
    const profile = await resolveProfile(
      catalogService,
      productId,
      sharedContext
    )
    if (!profile) {
      return
    }

    await deleteProfileRelations(
      catalogService,
      profile.id,
      "artists",
      sharedContext
    )
    await deleteProfileRelations(
      catalogService,
      profile.id,
      "references",
      sharedContext
    )
    const [variantProfiles, bundleProfiles, mediaItems, shelfProducts] =
      await Promise.all([
        catalogService.listCatalogVariantProfiles(
          { product_profile_id: profile.id },
          {},
          sharedContext
        ),
        catalogService.listCatalogBundleProfiles(
          { product_profile_id: profile.id },
          {},
          sharedContext
        ),
        catalogService.listCatalogProductMediaItems(
          { product_profile_id: profile.id },
          {},
          sharedContext
        ),
        catalogService.listCatalogShelfProducts(
          { product_profile_id: profile.id },
          {},
          sharedContext
        ),
      ])
    await Promise.all([
      variantProfiles.length
        ? catalogService.updateCatalogVariantProfiles(
            variantProfiles.map((variantProfile) => ({
              id: variantProfile.id,
              product_profile_id: null,
            })),
            sharedContext
          )
        : Promise.resolve([]),
      bundleProfiles.length
        ? catalogService.updateCatalogBundleProfiles(
            bundleProfiles.map((bundleProfile) => ({
              id: bundleProfile.id,
              product_profile_id: null,
            })),
            sharedContext
          )
        : Promise.resolve([]),
      mediaItems.length
        ? catalogService.updateCatalogProductMediaItems(
            mediaItems.map((mediaItem) => ({
              id: mediaItem.id,
              product_profile_id: null,
            })),
            sharedContext
          )
        : Promise.resolve([]),
      shelfProducts.length
        ? catalogService.updateCatalogShelfProducts(
            shelfProducts.map((shelfProduct) => ({
              id: shelfProduct.id,
              product_profile_id: null,
            })),
            sharedContext
          )
        : Promise.resolve([]),
    ])
    await catalogService.deleteCatalogProductProfiles(
      profile.id,
      sharedContext
    )
  })
  res.sendStatus(204)
}
