import { ModuleProviderExports } from "@medusajs/framework/types"
import { FeedNotificationService } from "./services/feed"

const services = [FeedNotificationService]

const providerExport: ModuleProviderExports = {
  services,
}

export default providerExport
