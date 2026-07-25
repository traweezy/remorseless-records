import type { ExecArgs } from '@medusajs/framework/types'
import {
  ContainerRegistrationKeys,
  Modules,
} from '@medusajs/framework/utils'

const STANDARD_NAME = 'Standard Shipping'
const EXPRESS_NAME = 'Express Shipping'
const PROVIDER_ID = 'per_item_standard'
const DEFAULT_STOCK_LOCATION_NAME = 'HQ'

const BASE_AMOUNT = 5
const ADDITIONAL_AMOUNT = 0.5
const CURRENCY_CODE = 'usd'

type ShippingOption = {
  id: string
  name?: string | null
  provider_id?: string | null
  price_type?: string | null
  service_zone_id?: string | null
  type?: { code?: string | null } | null
}

type StockLocation = {
  id: string
  name?: string | null
  fulfillment_providers?: Array<{ id: string }> | null
  fulfillment_sets?: Array<{
    id: string
    service_zones?: Array<{ id: string }> | null
  }> | null
}

type QueryGraph = {
  graph: (input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data: StockLocation[] }>
}

export default async function updateShippingOptions({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK) as {
    create: (data: Record<string, unknown>) => Promise<unknown>
  }
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY
  ) as QueryGraph
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT) as {
    listShippingOptions: (
      filters?: Record<string, unknown>,
      config?: { relations?: string[] }
    ) => Promise<ShippingOption[]>
    updateShippingOptions: (
      id: string,
      data: Record<string, unknown>
    ) => Promise<unknown>
    deleteShippingOptions: (ids: string[] | string) => Promise<void>
    updateServiceZones: (
      id: string,
      data: Record<string, unknown>
    ) => Promise<unknown>
  }

  const stockLocationName =
    process.env.SHIPPING_STOCK_LOCATION_NAME?.trim() ||
    DEFAULT_STOCK_LOCATION_NAME
  const { data: stockLocations } = await query.graph({
    entity: 'stock_location',
    fields: [
      'id',
      'name',
      'fulfillment_providers.id',
      'fulfillment_sets.id',
      'fulfillment_sets.service_zones.id',
    ],
    filters: { name: stockLocationName },
  })
  if (stockLocations.length !== 1) {
    throw new Error(
      `[shipping] Expected one "${stockLocationName}" stock location, found ${stockLocations.length}.`
    )
  }

  const stockLocation = stockLocations[0]
  if (!stockLocation) {
    throw new Error(
      `[shipping] Stock location "${stockLocationName}" disappeared during lookup.`
    )
  }

  const serviceZoneIds = Array.from(
    new Set(
      (stockLocation.fulfillment_sets ?? []).flatMap((fulfillmentSet) =>
        (fulfillmentSet.service_zones ?? []).map((serviceZone) => serviceZone.id)
      )
    )
  )
  if (!serviceZoneIds.length) {
    throw new Error(
      `[shipping] Stock location "${stockLocationName}" has no service zone.`
    )
  }

  if (
    !(stockLocation.fulfillment_providers ?? []).some(
      (provider) => provider.id === PROVIDER_ID
    )
  ) {
    await link.create({
      [Modules.STOCK_LOCATION]: {
        stock_location_id: stockLocation.id,
      },
      [Modules.FULFILLMENT]: {
        fulfillment_provider_id: PROVIDER_ID,
      },
    })
    logger.info(
      `[shipping] Enabled ${PROVIDER_ID} for "${stockLocationName}".`
    )
  }

  for (const serviceZoneId of serviceZoneIds) {
    await fulfillmentModuleService.updateServiceZones(serviceZoneId, {
      geo_zones: [
        {
          type: 'country',
          country_code: 'us',
        },
      ],
    })
  }

  const options = await fulfillmentModuleService.listShippingOptions({}, {
    relations: ['type'],
  })

  const targetOptions = options.filter(
    (option) =>
      option.service_zone_id &&
      serviceZoneIds.includes(option.service_zone_id)
  )
  const targetOption =
    targetOptions.find((option) => option.name === STANDARD_NAME) ??
    (targetOptions.length === 1 ? targetOptions[0] : null)
  const expressOptions = options.filter((option) => {
    if (option.name === EXPRESS_NAME) {
      return true
    }
    return option.type?.code === 'express'
  })

  if (!targetOption) {
    throw new Error(
      `[shipping] Could not choose one shipping option for "${stockLocationName}".`
    )
  }

  await fulfillmentModuleService.updateShippingOptions(targetOption.id, {
    name: STANDARD_NAME,
    provider_id: PROVIDER_ID,
    price_type: 'calculated',
    data: {
      base_amount: BASE_AMOUNT,
      additional_amount: ADDITIONAL_AMOUNT,
      currency_code: CURRENCY_CODE,
    },
  })
  logger.info(
    `[shipping] Updated ${targetOption.id} (${STANDARD_NAME}) at "${stockLocationName}" to per-item pricing.`
  )

  if (!expressOptions.length) {
    logger.info('[shipping] No Express shipping options found to delete.')
  } else {
    const expressIds = expressOptions.map((option) => option.id)
    await fulfillmentModuleService.deleteShippingOptions(expressIds)
    logger.info(
      `[shipping] Deleted ${expressIds.length} Express shipping option(s).`
    )
  }
}
