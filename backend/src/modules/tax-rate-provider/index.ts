import { ModuleProviderExports } from '@medusajs/framework/types'

import TaxRateLookupProviderService from './service'

const services = [TaxRateLookupProviderService]

const providerExport: ModuleProviderExports = {
  services,
}

export default providerExport
