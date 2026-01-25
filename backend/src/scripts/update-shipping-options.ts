import type { ExecArgs } from '@medusajs/framework/types'
import {
  ContainerRegistrationKeys,
  Modules,
} from '@medusajs/framework/utils'

const STANDARD_NAME = 'Standard Shipping'
const EXPRESS_NAME = 'Express Shipping'
const PROVIDER_ID = 'per_item_standard'

const BASE_AMOUNT = 500
const ADDITIONAL_AMOUNT = 50
const CURRENCY_CODE = 'usd'

type ShippingOption = {
  id: string
  name?: string | null
  provider_id?: string | null
  price_type?: string | null
  type?: { code?: string | null } | null
}

export default async function updateShippingOptions({
  container,
}: ExecArgs): Promise<void> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
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
  }

  const options = await fulfillmentModuleService.listShippingOptions({}, {
    relations: ['type'],
  })

  const standardOptions = options.filter(
    (option) => option.name === STANDARD_NAME
  )
  const expressOptions = options.filter((option) => {
    if (option.name === EXPRESS_NAME) {
      return true
    }
    return option.type?.code === 'express'
  })

  if (!standardOptions.length) {
    logger.warn(`[shipping] No "${STANDARD_NAME}" options found to update.`)
  }

  for (const option of standardOptions) {
    await fulfillmentModuleService.updateShippingOptions(option.id, {
      provider_id: PROVIDER_ID,
      price_type: 'calculated',
      data: {
        base_amount: BASE_AMOUNT,
        additional_amount: ADDITIONAL_AMOUNT,
        currency_code: CURRENCY_CODE,
      },
    })

    logger.info(
      `[shipping] Updated ${option.id} (${STANDARD_NAME}) to per-item pricing.`
    )
  }

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
