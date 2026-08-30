import type { ModuleProviderLoaderFunction } from "@medusajs/framework/types"

import {
  formatTaxCacheConfigLog,
  resolveProviderTaxCacheConfig,
  type TaxCacheProviderOptions,
} from "../../../lib/tax-control/cache-config"

const configureTaxCaches: ModuleProviderLoaderFunction = async ({
  logger,
  options,
}): Promise<void> => {
  const config = resolveProviderTaxCacheConfig(
    (options ?? {}) as TaxCacheProviderOptions
  )
  logger?.info(formatTaxCacheConfigLog(config))
}

export default configureTaxCaches
