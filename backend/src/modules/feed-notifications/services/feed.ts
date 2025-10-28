import type {
  Logger,
  NotificationTypes,
} from "@medusajs/framework/types"
import { AbstractNotificationProviderService } from "@medusajs/framework/utils"

type InjectedDependencies = {
  logger: Logger
}

export class FeedNotificationService extends AbstractNotificationProviderService {
  static override identifier = "FEED_NOTIFICATION_SERVICE"
  protected readonly logger: Logger

  constructor({ logger }: InjectedDependencies) {
    super()
    this.logger = logger
  }

  override async send(
    notification: NotificationTypes.ProviderSendNotificationDTO
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    this.logger.debug?.(`[feed-notification] Swallowing feed notification`)
    return {}
  }
}
