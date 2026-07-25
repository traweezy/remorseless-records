import {
  ContainerRegistrationKeys,
  Modules,
} from '@medusajs/framework/utils'

import updateShippingOptions from './update-shipping-options'

const createHarness = ({
  providerLinked = false,
  stockLocations = [
    {
      id: 'sloc_hq',
      name: 'HQ',
      fulfillment_providers: [],
      fulfillment_sets: [
        {
          id: 'fuset_hq',
          service_zones: [{ id: 'serzo_hq' }],
        },
      ],
    },
  ],
}: {
  providerLinked?: boolean
  stockLocations?: unknown[]
} = {}) => {
  const graph = jest.fn().mockResolvedValue({
    data: providerLinked
      ? [
          {
            ...(stockLocations[0] as Record<string, unknown>),
            fulfillment_providers: [{ id: 'per_item_standard' }],
          },
        ]
      : stockLocations,
  })
  const create = jest.fn().mockResolvedValue(undefined)
  const updateServiceZones = jest.fn().mockResolvedValue(undefined)
  const updateShippingOptions = jest.fn().mockResolvedValue(undefined)
  const deleteShippingOptions = jest.fn().mockResolvedValue(undefined)
  const listShippingOptions = jest.fn().mockResolvedValue([
    {
      id: 'so_obsolete',
      name: 'Standard Shipping',
      service_zone_id: 'serzo_obsolete',
      type: { code: 'standard' },
    },
    {
      id: 'so_hq',
      name: 'Default Shipping',
      service_zone_id: 'serzo_hq',
      type: { code: 'default' },
    },
    {
      id: 'so_express',
      name: 'Express Shipping',
      service_zone_id: 'serzo_obsolete',
      type: { code: 'express' },
    },
  ])
  const logger = { info: jest.fn(), warn: jest.fn() }
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === ContainerRegistrationKeys.LOGGER) {
        return logger
      }
      if (key === ContainerRegistrationKeys.LINK) {
        return { create }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return { graph }
      }
      if (key === Modules.FULFILLMENT) {
        return {
          deleteShippingOptions,
          listShippingOptions,
          updateServiceZones,
          updateShippingOptions,
        }
      }
      throw new Error(`Unexpected registration: ${key}`)
    }),
  }

  return {
    container,
    create,
    deleteShippingOptions,
    graph,
    updateServiceZones,
    updateShippingOptions,
  }
}

describe('updateShippingOptions', () => {
  it('moves the storefront contract to the configured inventory location', async () => {
    const harness = createHarness()

    await updateShippingOptions({
      container: harness.container as never,
      args: [],
    })

    expect(harness.graph).toHaveBeenCalledWith({
      entity: 'stock_location',
      fields: [
        'id',
        'name',
        'fulfillment_providers.id',
        'fulfillment_sets.id',
        'fulfillment_sets.service_zones.id',
      ],
      filters: { name: 'HQ' },
    })
    expect(harness.create).toHaveBeenCalledWith({
      [Modules.STOCK_LOCATION]: { stock_location_id: 'sloc_hq' },
      [Modules.FULFILLMENT]: {
        fulfillment_provider_id: 'per_item_standard',
      },
    })
    expect(harness.updateServiceZones).toHaveBeenCalledWith('serzo_hq', {
      geo_zones: [{ type: 'country', country_code: 'us' }],
    })
    expect(harness.updateShippingOptions).toHaveBeenCalledWith('so_hq', {
      name: 'Standard Shipping',
      provider_id: 'per_item_standard',
      price_type: 'calculated',
      data: {
        base_amount: 5,
        additional_amount: 0.5,
        currency_code: 'usd',
      },
    })
    expect(harness.deleteShippingOptions).toHaveBeenCalledWith(['so_express'])
  })

  it('is idempotent when the provider link already exists', async () => {
    const harness = createHarness({ providerLinked: true })

    await updateShippingOptions({
      container: harness.container as never,
      args: [],
    })

    expect(harness.create).not.toHaveBeenCalled()
    expect(harness.updateShippingOptions).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the target stock location is ambiguous', async () => {
    const harness = createHarness({
      stockLocations: [
        { id: 'sloc_1', name: 'HQ' },
        { id: 'sloc_2', name: 'HQ' },
      ],
    })

    await expect(
      updateShippingOptions({
        container: harness.container as never,
        args: [],
      })
    ).rejects.toThrow('Expected one "HQ" stock location, found 2')

    expect(harness.create).not.toHaveBeenCalled()
    expect(harness.updateShippingOptions).not.toHaveBeenCalled()
  })
})
