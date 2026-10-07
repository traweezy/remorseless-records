import { MedusaError } from "@medusajs/framework/utils"

import type CatalogModuleService from "@/modules/catalog/service"
import {
  asUnknownRecord,
  readRecordArray,
  type UnknownRecord,
} from "@/lib/provider-boundary/records"
import {
  readCatalogProductArtists,
  readCatalogProductProfiles,
  readCatalogProductReferences,
  readCatalogReferenceValueList,
} from "./profile-persistence-contracts"
import {
  readCatalogMediaAssets,
  readCatalogProductMediaItems,
} from "./transaction-persistence-contracts"
import {
  compareCatalogMediaItems,
  selectActiveCatalogMedia,
} from "./media-presentation"

export const STORE_PRESENTATION_PAGE_LIMIT = 25
type CatalogService = InstanceType<typeof CatalogModuleService>

const invalid = (): never => {
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "The public catalog presentation returned invalid structured data."
  )
}

// Group only rows belonging to the already visibility-checked product set.
// Existing persistence readers then validate each complete aggregate.
const groupRows = (
  value: unknown,
  field: string,
  expected: readonly string[],
  perGroup: number
): Map<string, UnknownRecord[]> => {
  const rows = readRecordArray(value, { context: "Public catalog" })
  if (rows.length > expected.length * perGroup) invalid()
  const groups = new Map(expected.map((id) => [id, [] as UnknownRecord[]]))
  const seen = new Set<unknown>()
  for (const row of rows) {
    const group =
      groups.get(typeof row[field] === "string" ? row[field] : invalid()) ??
      invalid()
    if (group.length >= perGroup || seen.has(row.id)) invalid()
    seen.add(row.id)
    group.push(row)
  }
  return groups
}

const publicText = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length ? value.trim() : null

const documentText = (value: unknown): string | null => {
  const record = asUnknownRecord(value)
  return record ? (publicText(record.text) ?? publicText(record.notes)) : null
}

export const loadStoreCatalogPresentations = async (
  catalog: CatalogService,
  productIds: readonly string[]
) => {
  if (
    !productIds.length ||
    productIds.length > STORE_PRESENTATION_PAGE_LIMIT ||
    new Set(productIds).size !== productIds.length ||
    productIds.some((id) => !/^prod_[A-Za-z0-9_-]{1,249}$/u.test(id))
  )
    invalid()

  const ids = [...productIds]
  const [rawProfiles, rawMedia] = await Promise.all([
    catalog.listCatalogProductProfiles(
      { product_id: ids },
      { take: ids.length + 1 }
    ),
    catalog.listCatalogProductMediaItems(
      { product_id: ids },
      { take: ids.length * 100 + 1, order: { sort_order: "ASC", id: "ASC" } }
    ),
  ])
  const profileGroups = groupRows(rawProfiles, "product_id", ids, 1)
  const mediaGroups = groupRows(rawMedia, "product_id", ids, 100)
  const profiles = ids.flatMap((id) =>
    readCatalogProductProfiles(profileGroups.get(id), id)
  )
  const media = ids.flatMap((id) =>
    readCatalogProductMediaItems(mediaGroups.get(id), { productId: id }, 100)
  )
  const profileIds = profiles.map((profile) => profile.id)
  const assetIds = [...new Set(media.map((item) => item.media_asset_id))]
  const [rawArtists, rawReferences, rawAssets] = await Promise.all([
    profileIds.length
      ? catalog.listCatalogProductArtists(
          { product_profile_id: profileIds },
          { take: profileIds.length * 100 + 1 }
        )
      : [],
    profileIds.length
      ? catalog.listCatalogProductReferences(
          { product_profile_id: profileIds },
          { take: profileIds.length * 100 + 1 }
        )
      : [],
    assetIds.length
      ? catalog.listCatalogMediaAssets(
          { id: assetIds },
          { take: assetIds.length + 1 }
        )
      : [],
  ])
  const artistGroups = groupRows(
    rawArtists,
    "product_profile_id",
    profileIds,
    100
  )
  const referenceGroups = groupRows(
    rawReferences,
    "product_profile_id",
    profileIds,
    100
  )
  const artists = profiles.flatMap((profile) =>
    readCatalogProductArtists(artistGroups.get(profile.id), profile.id)
  )
  const references = profiles.flatMap((profile) =>
    readCatalogProductReferences(referenceGroups.get(profile.id), profile.id)
  )
  const assets = readCatalogMediaAssets(rawAssets, {
    expectedIds: assetIds,
    maximumRows: assetIds.length,
    requireExactIds: true,
  })
  const referenceIds = [
    ...new Set(
      [
        ...profiles.flatMap((profile) => [
          profile.label_id,
          profile.product_type_id,
        ]),
        ...references.map((reference) => reference.reference_value_id),
      ].filter((id): id is string => id !== null)
    ),
  ]
  const values = readCatalogReferenceValueList(
    referenceIds.length
      ? await catalog.listCatalogReferenceValues(
          { id: referenceIds },
          { take: referenceIds.length + 1 }
        )
      : [],
    { expectedIds: referenceIds, maximumRows: referenceIds.length }
  )
  if (values.length !== referenceIds.length) invalid()
  const valuesById = new Map(values.map((value) => [value.id, value]))
  return ids.map((productId) => {
    const profile = profiles.find((row) => row.product_id === productId)
    const items = media
      .filter((row) => row.product_id === productId)
      .sort(compareCatalogMediaItems)
    const reference = (id: string | null | undefined, kind: string) => {
      if (!id) return null
      const value = valuesById.get(id)
      if (!value || value.kind !== kind) return invalid()
      return value
    }
    const merch = asUnknownRecord(profile?.merch_details)
    return {
      productId,
      profile: profile
        ? {
            productType:
              reference(profile.product_type_id, "product_type")?.value ?? null,
            label: reference(profile.label_id, "label")?.label ?? null,
            artists: artists
              .filter((artist) => artist.product_profile_id === profile.id)
              .sort(
                (left, right) =>
                  left.sort_order - right.sort_order ||
                  left.id.localeCompare(right.id)
              )
              .map((artist) => artist.display_name),
            genres: references
              .filter(
                (row) =>
                  row.product_profile_id === profile.id && row.kind === "genre"
              )
              .sort(
                (left, right) =>
                  left.sort_order - right.sort_order ||
                  left.id.localeCompare(right.id)
              )
              .map((row) => reference(row.reference_value_id, "genre")!.label),
            descriptionHtml: profile.description_html,
            tracklist: (profile.tracklist as unknown[]).flatMap((track) => {
              const title =
                publicText(track) ?? publicText(asUnknownRecord(track)?.title)
              return title ? [title] : []
            }),
            credits: documentText(profile.credits),
            pressingNotes: documentText(profile.pressing_notes),
            merch: {
              material: publicText(merch?.material),
              fit: publicText(merch?.fit),
              sizeGuide: publicText(merch?.sizeGuide),
              care: publicText(merch?.care),
            },
          }
        : null,
      // Catalog profiles own media presentation, including an intentionally
      // empty gallery after removal. Quarantine/removal must not revive a
      // stale native thumbnail. Only products without a catalog profile or
      // media links retain legacy presentation during the cutover.
      managedMedia: Boolean(profile) || items.length > 0,
      images: selectActiveCatalogMedia(items, assets).map(
        ({ item, asset }) => ({
          id: item.id,
          url: asset.source_url,
          alt: asset.alt_text,
          width: asset.width,
          height: asset.height,
        })
      ),
    }
  })
}
