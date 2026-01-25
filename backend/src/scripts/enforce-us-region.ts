import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { deleteRegionsWorkflow, updateStoresWorkflow } from "@medusajs/medusa/core-flows"

type RegionCountry = {
  iso_2?: string | null
}

type RegionRecord = {
  id: string
  name?: string | null
  currency_code?: string | null
  countries?: RegionCountry[] | null
}

const isUsRegion = (region: RegionRecord): boolean => {
  if (region.currency_code?.toLowerCase() === "usd") {
    return true
  }

  if (region.name?.toLowerCase().includes("us")) {
    return true
  }

  return (region.countries ?? []).some(
    (country) => country.iso_2?.toLowerCase() === "us"
  )
}

export default async function enforceUsRegion({ container }: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const regionModule = container.resolve(Modules.REGION) as {
    listRegions: (
      filters?: Record<string, unknown>,
      config?: { relations?: string[] }
    ) => Promise<RegionRecord[]>
  }
  const storeModule = container.resolve(Modules.STORE) as {
    listStores: (filters?: Record<string, unknown>) => Promise<{ id: string }[]>
  }
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as {
    listShippingOptions: (
      filters?: Record<string, unknown>,
      config?: { relations?: string[] }
    ) => Promise<
      Array<{
        id: string
        name?: string | null
        service_zone_id?: string | null
      }>
    >
    updateServiceZones: (
      id: string,
      data: Record<string, unknown>
    ) => Promise<unknown>
  }

  const regions = await regionModule.listRegions({}, { relations: ["countries"] })
  if (!regions.length) {
    logger.warn("[region] No regions found to enforce.")
    return
  }

  const usRegion = regions.find(isUsRegion) ?? null
  if (!usRegion) {
    logger.warn("[region] No US region found. Aborting without deletion.")
    return
  }

  const deleteIds = regions
    .filter((region) => region.id !== usRegion.id)
    .map((region) => region.id)

  if (deleteIds.length) {
    await deleteRegionsWorkflow(container).run({
      input: { ids: deleteIds },
    })
    logger.info(`[region] Deleted ${deleteIds.length} non-US region(s).`)
  } else {
    logger.info("[region] Only US region present; nothing to delete.")
  }

  const stores = await storeModule.listStores()
  const store = stores[0]
  if (store?.id) {
    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          supported_currencies: [
            {
              currency_code: "usd",
              is_default: true,
            },
          ],
        },
      },
    })
    logger.info("[store] Updated store currencies to USD only.")
  } else {
    logger.warn("[store] No store found to update currencies.")
  }

  const shippingOptions = await fulfillmentModule.listShippingOptions({}, {
    relations: ["service_zone", "service_zone.geo_zones"],
  })
  const serviceZoneIds = Array.from(
    new Set(
      shippingOptions
        .filter((option) => option.name === "Standard Shipping")
        .map((option) => option.service_zone_id)
        .filter((id): id is string => Boolean(id))
    )
  )

  if (!serviceZoneIds.length) {
    logger.warn("[shipping] No Standard Shipping service zones found to update.")
    return
  }

  for (const serviceZoneId of serviceZoneIds) {
    await fulfillmentModule.updateServiceZones(serviceZoneId, {
      name: "US",
      geo_zones: [
        {
          type: "country",
          country_code: "us",
        },
      ],
    })
  }

  logger.info(
    `[shipping] Updated ${serviceZoneIds.length} service zone(s) to US.`
  )
}
