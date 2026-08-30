import { ModuleProviderExports } from '@medusajs/framework/types'

import configureTaxCaches from './loaders/cache-config'
import TaxRateLookupProviderService from './service'

const services = [TaxRateLookupProviderService]
const loaders = [configureTaxCaches]

const providerExport: ModuleProviderExports = {
  loaders,
  services,
}

export default providerExport
