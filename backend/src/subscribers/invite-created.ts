import type {
  CreateNotificationDTO,
  INotificationModuleService,
  IUserModuleService,
} from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

import { BACKEND_URL } from "../lib/constants"
import {
  buildInviteNotificationLink,
  createAndVerifyNotifications,
  inviteNotificationIdempotencyKey,
  readInviteNotificationProjection,
  readNotificationEntityId,
} from "../lib/notifications/contracts"
import { emailIdempotencyFields } from "../modules/email-notifications/idempotency"
import { EmailTemplates } from "../modules/email-notifications/templates"

type InviteEventData = {
  id: string
}

export default async function userInviteHandler({
  event: { data, name },
  container,
}: SubscriberArgs<InviteEventData>): Promise<void> {
  const inviteId = readNotificationEntityId(data?.id, "invite")
  if (!inviteId) {
    throw new Error("Invite notification event is malformed.")
  }
  if (name !== "invite.created" && name !== "invite.resent") {
    throw new Error("Invite notification event is malformed.")
  }
  const notificationModuleService: INotificationModuleService =
    container.resolve(Modules.NOTIFICATION)
  const userModuleService: IUserModuleService = container.resolve(Modules.USER)
  const inviteValue: unknown = await userModuleService.retrieveInvite(inviteId)
  const invite = readInviteNotificationProjection(inviteValue, inviteId)
  const idempotencyKey = inviteNotificationIdempotencyKey(invite)

  const payload: CreateNotificationDTO = {
    ...emailIdempotencyFields(idempotencyKey),
    to: invite.email,
    channel: "email",
    template: EmailTemplates.INVITE_USER,
    trigger_type: name,
    resource_id: invite.id,
    resource_type: "invite",
    receiver_id: invite.id,
    data: {
      emailOptions: {
        subject: "You've been invited to Medusa!",
      },
      inviteLink: buildInviteNotificationLink(BACKEND_URL, invite.token),
      preview: "The administration dashboard awaits...",
    },
  }

  await createAndVerifyNotifications(notificationModuleService, [payload], {
    [idempotencyKey]: {
      delivery_state: "sent",
      secret_fields: "redacted",
      version: 1,
    },
  })
}

export const config: SubscriberConfig = {
  event: ["invite.created", "invite.resent"],
}
