import type { ModuleProviderExports } from '@medusajs/framework/types'

import PerItemFulfillmentService from './service'

const services = [PerItemFulfillmentService]

const providerExport: ModuleProviderExports = {
  services,
}

export default providerExport
