import { EntityManager } from "@medusajs/framework/mikro-orm/knex"
import type { Context } from "@medusajs/framework/types"

import {
  catalogAvailabilityStatusValues,
  serializeCatalogVariantProfile,
  type CatalogAvailabilityStatus,
  type CatalogVariantProfileRecord,
} from "../../modules/catalog/serializers"
import { coerceCatalogJsonRecord } from "./normalization"
import type {
  CatalogVariantProfileSnapshot,
  CatalogVariantProfileState,
} from "./variant-profile-contract"
import type { CatalogService } from "./reference-resolution"

const toCatalogAvailabilityStatus = (
  value: unknown
): CatalogAvailabilityStatus =>
  catalogAvailabilityStatusValues.find((status) => status === value) ??
  "available"

const profileState = (
  profile: CatalogVariantProfileRecord
): CatalogVariantProfileState => ({
  availability_status: toCatalogAvailabilityStatus(profile.availability_status),
  backorder_allowed: profile.backorder_allowed,
  backorder_note: profile.backorder_note,
  display_label: profile.display_label,
  format_detail_id: profile.format_detail_id,
  format_detail_label: profile.format_detail_label,
  format_id: profile.format_id,
  format_label: profile.format_label,
  id: profile.id,
  image_url: profile.image_url,
  metadata: coerceCatalogJsonRecord(profile.metadata),
  preorder_allowed: profile.preorder_allowed,
  preorder_release_date: profile.preorder_release_date,
  product_profile_id: profile.product_profile_id,
  variant_id: profile.variant_id,
  version: profile.version,
})

export const resolveCatalogVariantProfile = async (
  catalogService: CatalogService,
  variantId: string,
  sharedContext?: Context<EntityManager>
) => {
  const profiles = await catalogService.listCatalogVariantProfiles(
    { variant_id: variantId },
    {},
    sharedContext
  )
  return profiles.at(0) ?? null
}

export const serializeCatalogVariantProfileResponse = (
  profile: NonNullable<
    Awaited<ReturnType<typeof resolveCatalogVariantProfile>>
  > | null
) => ({
  profile: profile ? serializeCatalogVariantProfile(profile) : null,
})

export const snapshotCatalogVariantProfile = async (
  catalogService: CatalogService,
  variantId: string,
  sharedContext: Context<EntityManager>
): Promise<CatalogVariantProfileSnapshot> => {
  const profile = await resolveCatalogVariantProfile(
    catalogService,
    variantId,
    sharedContext
  )
  return {
    profile: profile
      ? profileState(profile as CatalogVariantProfileRecord)
      : null,
  }
}

export const restoreCatalogVariantProfileSnapshot = async (
  catalogService: CatalogService,
  variantId: string,
  snapshot: CatalogVariantProfileSnapshot,
  sharedContext: Context<EntityManager>
): Promise<void> => {
  const current = await resolveCatalogVariantProfile(
    catalogService,
    variantId,
    sharedContext
  )
  if (!snapshot.profile) {
    if (current) {
      await catalogService.deleteCatalogVariantProfiles(
        current.id,
        sharedContext
      )
    }
    return
  }
  if (current && current.id !== snapshot.profile.id) {
    await catalogService.deleteCatalogVariantProfiles(current.id, sharedContext)
  }
  const { id: profileId, ...profileData } = snapshot.profile
  if (current?.id === profileId) {
    await catalogService.updateCatalogVariantProfiles(
      [{ id: profileId, ...profileData }] as never,
      sharedContext
    )
    return
  }
  await catalogService.createCatalogVariantProfiles(
    [{ id: profileId, ...profileData }] as never,
    sharedContext
  )
}
