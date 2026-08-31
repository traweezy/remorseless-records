import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"

import type CatalogModuleService from "../../modules/catalog/service"
import type {
  CatalogArtistRecord,
  CatalogReferenceKind,
  CatalogReferenceValueRecord,
  JsonRecord,
} from "../../modules/catalog/serializers"
import { slugifyCatalogValue, toCatalogNullableString } from "./normalization"
import {
  readCatalogArtist,
  readCatalogArtistList,
  readCatalogArtistMutation,
  readCatalogReferenceValue,
  readCatalogReferenceValueList,
  readCatalogReferenceValueMutation,
} from "./profile-persistence-contracts"

export type CatalogService = InstanceType<typeof CatalogModuleService>

export type CatalogResolution<T> = {
  created: boolean
  record: T | null
}

export const resolveOrCreateCatalogArtist = async (
  catalogService: CatalogService,
  input: {
    artistId?: string | null | undefined
    name?: string | null | undefined
    metadata?: JsonRecord
  },
  sharedContext?: Context<EntityManager>
): Promise<CatalogResolution<CatalogArtistRecord>> => {
  const artistId = toCatalogNullableString(input.artistId)
  if (artistId) {
    const record = readCatalogArtist(
      await catalogService.retrieveCatalogArtist(artistId, {}, sharedContext),
      artistId
    )
    if (!record) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "The selected catalog artist was not found."
      )
    }
    return {
      created: false,
      record,
    }
  }

  const name = toCatalogNullableString(input.name)
  if (!name) {
    return { created: false, record: null }
  }

  const slug = slugifyCatalogValue(name, "artist")
  const existing = readCatalogArtistList(
    await catalogService.listCatalogArtists(
      { slug },
      { take: 2 },
      sharedContext
    ),
    { expectedSlug: slug, maximumRows: 1 }
  )
  const match = existing.at(0)
  if (match) {
    return { created: false, record: match }
  }

  const payload = {
    bio: null,
    image_url: null,
    location: null,
    metadata: input.metadata ?? {},
    name,
    slug,
    sort_name: name,
  }
  const created = readCatalogArtistMutation(
    await catalogService.createCatalogArtists([payload], sharedContext),
    { fields: payload }
  )

  return {
    created: true,
    record: created,
  }
}

export const createOrReuseCatalogArtist = async (
  catalogService: CatalogService,
  input: Parameters<typeof resolveOrCreateCatalogArtist>[1],
  sharedContext?: Context<EntityManager>
): Promise<CatalogArtistRecord | null> =>
  (await resolveOrCreateCatalogArtist(catalogService, input, sharedContext))
    .record

export const resolveOrCreateCatalogReferenceValue = async (
  catalogService: CatalogService,
  input: {
    referenceValueId?: string | null | undefined
    kind?: CatalogReferenceKind | null | undefined
    label?: string | null | undefined
    value?: string | null | undefined
    metadata?: JsonRecord
  },
  sharedContext?: Context<EntityManager>
): Promise<CatalogResolution<CatalogReferenceValueRecord>> => {
  const referenceValueId = toCatalogNullableString(input.referenceValueId)
  if (referenceValueId) {
    const record = readCatalogReferenceValue(
      await catalogService.retrieveCatalogReferenceValue(
        referenceValueId,
        {},
        sharedContext
      ),
      referenceValueId
    )
    if (!record) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        "The selected catalog reference value was not found."
      )
    }
    if (input.kind && record.kind !== input.kind) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `The selected reference value is not a ${input.kind}.`
      )
    }
    if (record.is_active === false) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The selected reference value is archived."
      )
    }
    return {
      created: false,
      record,
    }
  }

  const kind = input.kind ?? null
  const label = toCatalogNullableString(input.label)
  if (!kind || !label) {
    return { created: false, record: null }
  }

  const value =
    toCatalogNullableString(input.value) ?? slugifyCatalogValue(label, kind)
  const existing = readCatalogReferenceValueList(
    await catalogService.listCatalogReferenceValues(
      { kind, value },
      { take: 2 },
      sharedContext
    ),
    { expectedKind: kind, expectedValue: value, maximumRows: 1 }
  )
  const match = existing.at(0)
  if (match) {
    return { created: false, record: match }
  }

  const payload = {
    description: null,
    is_active: true,
    kind,
    label,
    metadata: input.metadata ?? {},
    rank: 0,
    value,
  }
  const created = readCatalogReferenceValueMutation(
    await catalogService.createCatalogReferenceValues([payload], sharedContext),
    { fields: payload }
  )

  return {
    created: true,
    record: created,
  }
}

export const createOrReuseCatalogReferenceValue = async (
  catalogService: CatalogService,
  input: Parameters<typeof resolveOrCreateCatalogReferenceValue>[1],
  sharedContext?: Context<EntityManager>
): Promise<CatalogReferenceValueRecord | null> =>
  (
    await resolveOrCreateCatalogReferenceValue(
      catalogService,
      input,
      sharedContext
    )
  ).record
