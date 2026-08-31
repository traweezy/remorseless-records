import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"

import {
  catalogReferenceKindValues,
  serializeCatalogProductArtist,
  serializeCatalogProductProfile,
  serializeCatalogProductReference,
  type CatalogProductArtistRecord,
  type CatalogProductProfileRecord,
  type CatalogProductReferenceRecord,
  type CatalogReferenceKind,
} from "../../modules/catalog/serializers"
import {
  coerceCatalogJsonList,
  coerceCatalogJsonRecord,
  normalizeCatalogList,
} from "./normalization"
import { readCatalogServiceIds } from "./persistence-contracts"
import {
  readCatalogProductArtists,
  readCatalogProductProfileMutation,
  readCatalogProductProfiles,
  readCatalogProductReferences,
  readExactCatalogProductArtists,
  readExactCatalogProductReferences,
} from "./profile-persistence-contracts"
import type {
  CatalogProductArtistState,
  CatalogProductProfileSnapshot,
  CatalogProductProfileState,
  CatalogProductReferenceState,
} from "./product-profile-contract"
import type { CatalogService } from "./reference-resolution"

export const toCatalogReferenceKind = (value: unknown): CatalogReferenceKind =>
  catalogReferenceKindValues.find((kind) => kind === value) ?? "utility_tag"

const profileState = (
  profile: CatalogProductProfileRecord
): CatalogProductProfileState => ({
  content_schema_version: profile.content_schema_version,
  credits: coerceCatalogJsonRecord(profile.credits),
  description_html: profile.description_html,
  id: profile.id,
  label_id: profile.label_id,
  merch_details: coerceCatalogJsonRecord(profile.merch_details),
  metadata: coerceCatalogJsonRecord(profile.metadata),
  pressing_notes: coerceCatalogJsonRecord(profile.pressing_notes),
  product_id: profile.product_id,
  product_type_id: profile.product_type_id,
  release_date: profile.release_date,
  release_date_precision: profile.release_date_precision,
  release_title: profile.release_title,
  release_year: profile.release_year,
  search_keywords: normalizeCatalogList(profile.search_keywords),
  tracklist: coerceCatalogJsonList(profile.tracklist),
  version: profile.version,
})

const artistState = (
  artist: CatalogProductArtistRecord
): CatalogProductArtistState => ({
  artist_id: artist.artist_id,
  display_name: artist.display_name,
  id: artist.id,
  metadata: coerceCatalogJsonRecord(artist.metadata),
  product_profile_id: artist.product_profile_id,
  role: artist.role,
  sort_order: artist.sort_order,
})

const referenceState = (
  reference: CatalogProductReferenceRecord
): CatalogProductReferenceState => ({
  id: reference.id,
  kind: toCatalogReferenceKind(reference.kind),
  metadata: coerceCatalogJsonRecord(reference.metadata),
  product_profile_id: reference.product_profile_id,
  reference_value_id: reference.reference_value_id,
  sort_order: reference.sort_order,
})

export const resolveCatalogProductProfile = async (
  catalogService: CatalogService,
  productId: string,
  sharedContext?: Context<EntityManager>
) => {
  const profiles = readCatalogProductProfiles(
    await catalogService.listCatalogProductProfiles(
      { product_id: productId },
      { take: 2 },
      sharedContext
    ),
    productId
  )
  return profiles.at(0) ?? null
}

export const loadCatalogProductProfileRelations = async (
  catalogService: CatalogService,
  profileId: string,
  sharedContext?: Context<EntityManager>
) => {
  const [rawArtists, rawReferences] = await Promise.all([
    catalogService.listCatalogProductArtists(
      { product_profile_id: profileId },
      { order: { sort_order: "ASC" }, take: 101 },
      sharedContext
    ),
    catalogService.listCatalogProductReferences(
      { product_profile_id: profileId },
      { order: { sort_order: "ASC" }, take: 101 },
      sharedContext
    ),
  ])
  const artists = readCatalogProductArtists(rawArtists, profileId)
  const references = readCatalogProductReferences(rawReferences, profileId)

  return {
    artists: artists.map(serializeCatalogProductArtist),
    references: references.map(serializeCatalogProductReference),
  }
}

export const serializeCatalogProductProfileResponse = async (
  catalogService: CatalogService,
  profile: NonNullable<
    Awaited<ReturnType<typeof resolveCatalogProductProfile>>
  > | null
) => {
  if (!profile) {
    return {
      artists: [],
      profile: null,
      references: [],
    }
  }

  return {
    ...(await loadCatalogProductProfileRelations(catalogService, profile.id)),
    profile: serializeCatalogProductProfile(profile),
  }
}

export const snapshotCatalogProductProfile = async (
  catalogService: CatalogService,
  productId: string,
  sharedContext: Context<EntityManager>
): Promise<CatalogProductProfileSnapshot> => {
  const profile = await resolveCatalogProductProfile(
    catalogService,
    productId,
    sharedContext
  )
  if (!profile) {
    return { artists: [], profile: null, references: [] }
  }

  const [rawArtists, rawReferences] = await Promise.all([
    catalogService.listCatalogProductArtists(
      { product_profile_id: profile.id },
      { order: { sort_order: "ASC" }, take: 101 },
      sharedContext
    ),
    catalogService.listCatalogProductReferences(
      { product_profile_id: profile.id },
      { order: { sort_order: "ASC" }, take: 101 },
      sharedContext
    ),
  ])
  const artists = readCatalogProductArtists(rawArtists, profile.id)
  const references = readCatalogProductReferences(rawReferences, profile.id)
  return {
    artists: artists.map(artistState),
    profile: profileState(profile),
    references: references.map(referenceState),
  }
}

const deleteProfileRelations = async (
  catalogService: CatalogService,
  profileId: string,
  sharedContext: Context<EntityManager>
): Promise<void> => {
  const [rawArtists, rawReferences] = await Promise.all([
    catalogService.listCatalogProductArtists(
      { product_profile_id: profileId },
      { take: 101 },
      sharedContext
    ),
    catalogService.listCatalogProductReferences(
      { product_profile_id: profileId },
      { take: 101 },
      sharedContext
    ),
  ])
  const artists = readCatalogProductArtists(rawArtists, profileId)
  const references = readCatalogProductReferences(rawReferences, profileId)
  if (artists.length) {
    await catalogService.deleteCatalogProductArtists(
      artists.map(({ id }) => id),
      sharedContext
    )
  }
  if (references.length) {
    await catalogService.deleteCatalogProductReferences(
      references.map(({ id }) => id),
      sharedContext
    )
  }
}

export const restoreCatalogProductProfileSnapshot = async (
  catalogService: CatalogService,
  aggregateId: string,
  snapshot: CatalogProductProfileSnapshot,
  sharedContext: Context<EntityManager>
): Promise<void> => {
  const current = await resolveCatalogProductProfile(
    catalogService,
    aggregateId,
    sharedContext
  )
  if (current) {
    await deleteProfileRelations(catalogService, current.id, sharedContext)
  }
  if (!snapshot.profile) {
    if (current) {
      await catalogService.deleteCatalogProductProfiles(
        current.id,
        sharedContext
      )
    }
    return
  }
  if (current && current.id !== snapshot.profile.id) {
    await catalogService.deleteCatalogProductProfiles(current.id, sharedContext)
  }
  const { id: profileId, ...profileData } = snapshot.profile
  if (current?.id === snapshot.profile.id) {
    readCatalogProductProfileMutation(
      await catalogService.updateCatalogProductProfiles(
        [{ id: profileId, ...profileData }] as never,
        sharedContext
      ),
      {
        fields: profileData,
        id: profileId,
        productId: aggregateId,
        version: snapshot.profile.version,
      }
    )
  } else {
    readCatalogProductProfileMutation(
      await catalogService.createCatalogProductProfiles(
        [{ id: profileId, ...profileData }] as never,
        sharedContext
      ),
      {
        fields: profileData,
        id: profileId,
        productId: aggregateId,
        version: snapshot.profile.version,
      }
    )
  }
  if (snapshot.artists.length) {
    readExactCatalogProductArtists(
      await catalogService.createCatalogProductArtists(
        snapshot.artists,
        sharedContext
      ),
      profileId,
      snapshot.artists
    )
  }
  if (snapshot.references.length) {
    readExactCatalogProductReferences(
      await catalogService.createCatalogProductReferences(
        snapshot.references,
        sharedContext
      ),
      profileId,
      snapshot.references
    )
  }
}

export const deleteCreatedArtistIfOrphaned = async (
  catalogService: CatalogService,
  artistId: string,
  sharedContext: Context<EntityManager>
): Promise<void> => {
  const assignments = readCatalogServiceIds(
    await catalogService.listCatalogProductArtists(
      { artist_id: artistId },
      { take: 1 },
      sharedContext
    ),
    1
  )
  if (!assignments.length) {
    await catalogService.deleteCatalogArtists(artistId, sharedContext)
  }
}

export const deleteCreatedReferenceIfOrphaned = async (
  catalogService: CatalogService,
  referenceValueId: string,
  sharedContext: Context<EntityManager>
): Promise<void> => {
  const raw = await Promise.all([
    catalogService.listCatalogProductProfiles(
      { label_id: referenceValueId },
      { take: 1 },
      sharedContext
    ),
    catalogService.listCatalogProductProfiles(
      { product_type_id: referenceValueId },
      { take: 1 },
      sharedContext
    ),
    catalogService.listCatalogProductReferences(
      { reference_value_id: referenceValueId },
      { take: 1 },
      sharedContext
    ),
    catalogService.listCatalogVariantProfiles(
      { format_id: referenceValueId },
      { take: 1 },
      sharedContext
    ),
    catalogService.listCatalogVariantProfiles(
      { format_detail_id: referenceValueId },
      { take: 1 },
      sharedContext
    ),
  ])
  const hasAssignments = raw.some(
    (value) => readCatalogServiceIds(value, 1).length > 0
  )
  if (!hasAssignments) {
    await catalogService.deleteCatalogReferenceValues(
      referenceValueId,
      sharedContext
    )
  }
}
