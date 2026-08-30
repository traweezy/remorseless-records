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
import {
  firstCatalogResult,
  slugifyCatalogValue,
  toCatalogNullableString,
} from "./normalization"

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
    return {
      created: false,
      record: (await catalogService.retrieveCatalogArtist(
        artistId,
        {},
        sharedContext
      )) as CatalogArtistRecord,
    }
  }

  const name = toCatalogNullableString(input.name)
  if (!name) {
    return { created: false, record: null }
  }

  const slug = slugifyCatalogValue(name, "artist")
  const existing = await catalogService.listCatalogArtists(
    { slug },
    {},
    sharedContext
  )
  const match = existing.at(0) as CatalogArtistRecord | undefined
  if (match) {
    return { created: false, record: match }
  }

  const created = await catalogService.createCatalogArtists(
    [
      {
        name,
        slug,
        sort_name: name,
        metadata: input.metadata ?? {},
      },
    ],
    sharedContext
  )

  return {
    created: true,
    record:
      (firstCatalogResult(created) as CatalogArtistRecord | undefined) ?? null,
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
    const record = (await catalogService.retrieveCatalogReferenceValue(
      referenceValueId,
      {},
      sharedContext
    )) as CatalogReferenceValueRecord
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
  const existing = await catalogService.listCatalogReferenceValues(
    { kind, value },
    {},
    sharedContext
  )
  const match = existing.at(0) as CatalogReferenceValueRecord | undefined
  if (match) {
    return { created: false, record: match }
  }

  const created = await catalogService.createCatalogReferenceValues(
    [
      {
        kind,
        label,
        value,
        rank: 0,
        is_active: true,
        metadata: input.metadata ?? {},
      },
    ],
    sharedContext
  )

  return {
    created: true,
    record:
      (firstCatalogResult(created) as
        | CatalogReferenceValueRecord
        | undefined) ?? null,
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
