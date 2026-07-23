import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

import {
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
  releaseTitle: z.string().trim().optional().nullable(),
  labelId: z.string().trim().optional().nullable(),
  label: namedReferenceInputSchema.optional().nullable(),
  productTypeId: z.string().trim().optional().nullable(),
  productType: namedReferenceInputSchema.optional().nullable(),
  releaseDate: z.string().trim().optional().nullable(),
  releaseYear: z.number().int().min(1900).max(2200).optional().nullable(),
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
  productId: string
) => {
  const profiles = await catalogService.listCatalogProductProfiles({
    product_id: productId,
  })
  return profiles.at(0) ?? null
}

const loadProfileRelations = async (
  catalogService: CatalogService,
  profileId: string
) => {
  const [artists, references] = await Promise.all([
    catalogService.listCatalogProductArtists(
      { product_profile_id: profileId },
      { order: { sort_order: "ASC" } }
    ),
    catalogService.listCatalogProductReferences(
      { product_profile_id: profileId },
      { order: { sort_order: "ASC" } }
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
  relation: "artists" | "references"
): Promise<void> => {
  if (relation === "artists") {
    const existing = await catalogService.listCatalogProductArtists({
      product_profile_id: profileId,
    })
    const ids = existing.map((artist) => artist.id)
    if (ids.length) {
      await catalogService.deleteCatalogProductArtists(ids)
    }
    return
  }

  const existing = await catalogService.listCatalogProductReferences({
    product_profile_id: profileId,
  })
  const ids = existing.map((reference) => reference.id)
  if (ids.length) {
    await catalogService.deleteCatalogProductReferences(ids)
  }
}

const resolveNamedReferenceId = async (
  catalogService: CatalogService,
  input: {
    id?: string | null | undefined
    kind: Extract<CatalogReferenceKind, "label" | "product_type">
    reference?: z.infer<typeof namedReferenceInputSchema> | null | undefined
  }
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
  })

  return value?.id ?? null
}

const upsertArtists = async (
  catalogService: CatalogService,
  profileId: string,
  artists: z.infer<typeof artistInputSchema>[]
): Promise<void> => {
  await deleteProfileRelations(catalogService, profileId, "artists")

  const payloads = []
  for (const [index, input] of artists.entries()) {
    const artist = await createOrReuseArtist(catalogService, {
      artistId: input.artistId,
      name: input.name ?? input.displayName,
      metadata: coerceJsonRecord(input.metadata),
    })
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
    await catalogService.createCatalogProductArtists(payloads)
  }
}

const upsertReferences = async (
  catalogService: CatalogService,
  profileId: string,
  references: z.infer<typeof referenceInputSchema>[]
): Promise<void> => {
  await deleteProfileRelations(catalogService, profileId, "references")

  const payloads = []
  for (const [index, input] of references.entries()) {
    const reference = await createOrReuseReferenceValue(catalogService, {
      referenceValueId: input.referenceValueId,
      kind: input.kind,
      label: input.label,
      value: input.value,
      metadata: coerceJsonRecord(input.metadata),
    })

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
    await catalogService.createCatalogProductReferences(payloads)
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
  const existing = await resolveProfile(catalogService, productId)

  const labelId = await resolveNamedReferenceId(catalogService, {
    id: parsed.data.labelId,
    kind: "label",
    reference: parsed.data.label,
  })
  const productTypeId = await resolveNamedReferenceId(catalogService, {
    id: parsed.data.productTypeId,
    kind: "product_type",
    reference: parsed.data.productType,
  })
  const payload: Record<string, unknown> = {
    product_id: productId,
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
  if (parsed.data.descriptionHtml !== undefined) {
    payload.description_html = toNullableString(parsed.data.descriptionHtml)
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
    ? await catalogService.updateCatalogProductProfiles([
        {
          id: existing.id,
          ...payload,
        },
      ])
    : await catalogService.createCatalogProductProfiles([payload])
  const saved = firstResult(savedResult)
  if (!saved) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Unable to save catalog product profile"
    )
  }

  if (parsed.data.artists !== undefined) {
    await upsertArtists(catalogService, saved.id, parsed.data.artists)
  }
  if (parsed.data.references !== undefined) {
    await upsertReferences(catalogService, saved.id, parsed.data.references)
  }

  const refreshed = await resolveProfile(catalogService, productId)
  res.status(existing ? 200 : 201).json(
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
  const profile = await resolveProfile(catalogService, productId)
  if (!profile) {
    res.sendStatus(204)
    return
  }

  await deleteProfileRelations(catalogService, profile.id, "artists")
  await deleteProfileRelations(catalogService, profile.id, "references")
  const variantProfiles = await catalogService.listCatalogVariantProfiles({
    product_profile_id: profile.id,
  })
  if (variantProfiles.length) {
    await catalogService.updateCatalogVariantProfiles(
      variantProfiles.map((variantProfile) => ({
        id: variantProfile.id,
        product_profile_id: null,
      }))
    )
  }
  await catalogService.deleteCatalogProductProfiles(profile.id)
  res.sendStatus(204)
}
