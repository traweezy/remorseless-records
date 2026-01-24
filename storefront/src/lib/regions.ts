import "server-only"

import type { HttpTypes } from "@medusajs/types"

import { siteMetadata } from "@/config/site"
import { storeClient } from "@/lib/medusa/client"

let cachedRegionId: string | null = null

const resolvePreferredRegion = (
  regions: HttpTypes.StoreRegion[],
  preferredCountry: string | null
): HttpTypes.StoreRegion | undefined => {
  if (!regions.length) {
    return undefined
  }

  if (preferredCountry) {
    const normalized = preferredCountry.toLowerCase()
    const byCountry = regions.find((region) =>
      region.countries?.some(
        (country) => country.iso_2?.toLowerCase() === normalized
      )
    )

    if (byCountry) {
      return byCountry
    }
  }

  return regions[0]
}

export const resolveRegionId = async (): Promise<string> => {
  if (cachedRegionId) {
    return cachedRegionId
  }

  const { regions } = await storeClient.region.list({ limit: 100 })
  const preferredCountry = siteMetadata.contact.address.country ?? null
  const region = resolvePreferredRegion(regions ?? [], preferredCountry)

  if (!region?.id) {
    throw new Error("No regions configured in Medusa")
  }

  cachedRegionId = region.id
  return region.id
}
