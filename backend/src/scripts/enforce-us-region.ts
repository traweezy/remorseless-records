import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  deleteRegionsWorkflow,
  updateRegionsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

type RegionCountry = {
  iso_2?: string | null
}

type RegionRecord = {
  id: string
  name?: string | null
  currency_code?: string | null
  countries?: RegionCountry[] | null
}

type PaymentProviderRecord = {
  id: string
  is_enabled?: boolean | null
}

type TaxProviderRecord = {
  id: string
  is_enabled?: boolean | null
}

type TaxRegionRecord = {
  id: string
  country_code?: string | null
  provider_id?: string | null
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
  let paymentModule: null | {
    listPaymentProviders: (
      filters?: Record<string, unknown>
    ) => Promise<PaymentProviderRecord[]>
  } = null
  try {
    paymentModule = container.resolve(Modules.PAYMENT)
  } catch (error) {
    logger.warn(`[payment] Payment module unavailable: ${String(error)}`)
  }
  const taxModule = container.resolve(Modules.TAX) as {
    listTaxProviders: (
      filters?: Record<string, unknown>
    ) => Promise<TaxProviderRecord[]>
    listTaxRegions: (
      filters?: Record<string, unknown>
    ) => Promise<TaxRegionRecord[]>
    createTaxRegions: (
      data: { country_code: string; provider_id?: string | null }
    ) => Promise<unknown>
    updateTaxRegions: (data: {
      id: string
      provider_id?: string | null
    }) => Promise<unknown>
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

  if (paymentModule) {
    const paymentProviders = await paymentModule.listPaymentProviders({
      is_enabled: true,
    })
    const providerIds = paymentProviders.map((provider) => provider.id)
    const stripeProviderId =
      providerIds.find((id) => id === "pp_stripe_stripe") ??
      providerIds.find((id) => id.includes("stripe")) ??
      null

    const desiredProviders: string[] = []
    if (stripeProviderId) {
      desiredProviders.push(stripeProviderId)
    }
    if (providerIds.includes("pp_system_default")) {
      desiredProviders.push("pp_system_default")
    }

    if (desiredProviders.length) {
      await updateRegionsWorkflow(container).run({
        input: {
          selector: { id: usRegion.id },
          update: {
            payment_providers: desiredProviders,
            automatic_taxes: true,
          },
        },
      })
      logger.info(
        `[region] Updated payment providers: ${desiredProviders.join(", ")}.`
      )
    } else {
      logger.warn(
        "[region] No enabled payment providers found; skipping payment provider update."
      )
    }
  }

  const taxProviders = await taxModule.listTaxProviders({ is_enabled: true })
  const rateLookupProvider =
    taxProviders.find((provider) =>
      provider.id.includes("rate-lookup")
    ) ??
    taxProviders.find((provider) => provider.id.includes("rate_lookup")) ??
    null

  if (!rateLookupProvider) {
    logger.warn(
      "[tax] No rate lookup tax provider found; skipping tax region update."
    )
  } else {
    const taxRegions = await taxModule.listTaxRegions({ country_code: "us" })
    if (!taxRegions.length) {
      await taxModule.createTaxRegions({
        country_code: "us",
        provider_id: rateLookupProvider.id,
      })
      logger.info(
        `[tax] Created US tax region with provider ${rateLookupProvider.id}.`
      )
    } else {
      const needsUpdate = taxRegions.filter(
        (region) => region.provider_id !== rateLookupProvider.id
      )
      for (const taxRegion of needsUpdate) {
        await taxModule.updateTaxRegions({
          id: taxRegion.id,
          provider_id: rateLookupProvider.id,
        })
      }
      if (needsUpdate.length) {
        logger.info(
          `[tax] Updated ${needsUpdate.length} US tax region(s) to provider ${rateLookupProvider.id}.`
        )
      } else {
        logger.info("[tax] US tax region already uses rate lookup provider.")
      }
    }
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
