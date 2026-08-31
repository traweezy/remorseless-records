import type { Logger, NotificationTypes } from "@medusajs/framework/types"
import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import { Resend, type CreateEmailOptions } from "resend"
import type { ReactElement } from "react"

import {
  readNotificationEmail,
  readNotificationText,
} from "../../../lib/notifications/contracts"
import { observeOperation } from "../../../lib/observability/operation-telemetry"
import { asUnknownRecord } from "../../../lib/provider-boundary/records"
import { emailProviderIdempotencyKey } from "../idempotency"
import { EmailTemplates, generateEmailTemplate } from "../templates"

type InjectedDependencies = {
  logger: Logger
}

interface ResendServiceConfig {
  apiKey: string
  from: string
}

export interface ResendNotificationServiceOptions {
  api_key: string
  from: string
}

export const RESEND_NOTIFICATION_TIMEOUT_MS = 5_000

const SUPPORTED_TEMPLATES = new Set<string>([
  EmailTemplates.INVITE_USER,
  EmailTemplates.ORDER_PLACED,
  EmailTemplates.REFUND_ISSUED,
])
const SAFE_PROVIDER_ID = /^[A-Za-z0-9_-]{1,255}$/

const invalidData = (message: string): MedusaError =>
  new MedusaError(MedusaError.Types.INVALID_DATA, message)

const readFromMailbox = (value: unknown): string | null => {
  const mailbox = readNotificationText(value, 320)
  if (!mailbox) {
    return null
  }
  if (readNotificationEmail(mailbox)) {
    return mailbox
  }
  const named = /^([^<>]{1,120}) <([^<>]+)>$/.exec(mailbox)
  return named?.[1]?.trim() && readNotificationEmail(named[2]) ? mailbox : null
}

/**
 * Service to handle email notifications using the Resend API.
 */
export class ResendNotificationService extends AbstractNotificationProviderService {
  static override identifier = "RESEND_NOTIFICATION_SERVICE"
  protected readonly resendConfig: ResendServiceConfig
  protected readonly logger: Logger
  private readonly resendClient: Resend

  constructor(
    { logger }: InjectedDependencies,
    options: ResendNotificationServiceOptions
  ) {
    super()
    const apiKey = readNotificationText(options.api_key, 512)
    const from = readFromMailbox(options.from)
    if (!apiKey || !from) {
      throw invalidData("Resend notification configuration is invalid.")
    }
    this.resendConfig = {
      apiKey,
      from,
    }
    this.logger = logger
    this.resendClient = new Resend(this.resendConfig.apiKey)
  }

  override async send(
    notification: NotificationTypes.ProviderSendNotificationDTO
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    if (!notification) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No notification information provided"
      )
    }

    if (notification.channel !== "email") {
      throw invalidData("Only email notifications are supported.")
    }
    if (!SUPPORTED_TEMPLATES.has(notification.template)) {
      throw invalidData("The email notification template is unsupported.")
    }

    const recipients = Array.isArray(notification.to)
      ? notification.to
      : typeof notification.to === "string"
        ? [notification.to]
        : []

    if (
      recipients.length !== 1 ||
      recipients.some((recipient) => !readNotificationEmail(recipient))
    ) {
      throw invalidData("The destination email is invalid.")
    }
    if (notification.from !== null && notification.from !== undefined) {
      throw invalidData("Per-notification senders are not supported.")
    }
    if (
      notification.attachments !== null &&
      notification.attachments !== undefined
    ) {
      throw invalidData("Email attachments are not supported.")
    }

    // Generate the email content using the template
    let emailContent: ReactElement

    try {
      const rendered = generateEmailTemplate(
        notification.template,
        notification.data
      )
      emailContent = rendered as ReactElement
    } catch (error: unknown) {
      if (error instanceof MedusaError) {
        throw error
      }

      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to generate email content for template "${notification.template}".`
      )
    }

    const data = asUnknownRecord(notification.data)
    const emailOptions = asUnknownRecord(data?.emailOptions)
    const subject = readNotificationText(emailOptions?.subject, 200)
    if (
      !data ||
      !emailOptions ||
      Object.keys(emailOptions).length !== 1 ||
      !subject
    ) {
      throw invalidData("The email notification subject is invalid.")
    }

    const providerIdempotencyKey = emailProviderIdempotencyKey(
      notification.provider_data
    )
    if (
      !providerIdempotencyKey ||
      !notification.provider_data ||
      Object.keys(notification.provider_data).length !== 1
    ) {
      throw invalidData("The email notification requires provider idempotency.")
    }

    const message: CreateEmailOptions = {
      to: recipients[0]!,
      from: this.resendConfig.from,
      react: emailContent,
      subject,
    }

    try {
      const requestOptions = {
        idempotencyKey: providerIdempotencyKey,
        signal: AbortSignal.timeout(RESEND_NOTIFICATION_TIMEOUT_MS),
      }
      const result = await observeOperation(
        { domain: "email", operation: "send" },
        () => this.resendClient.emails.send(message, requestOptions)
      )
      const resultRecord = asUnknownRecord(result)
      const resultData = asUnknownRecord(resultRecord?.data)
      if (
        resultRecord?.error !== null ||
        !resultData ||
        Object.keys(resultData).length !== 1 ||
        typeof resultData.id !== "string" ||
        !SAFE_PROVIDER_ID.test(resultData.id)
      ) {
        if (resultRecord?.error) {
          throw resultRecord.error
        }
        throw new Error("provider_response")
      }
      const externalId = resultData.id as string
      this.logger.info(
        `Sent "${notification.template}" email to ${recipients.length} recipient(s) via Resend`
      )
      return { id: externalId }
    } catch (error: unknown) {
      const code = parseResendErrorCode(error)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to send "${notification.template}" email (${code})`
      )
    }
  }
}

type ResendError = {
  name?: string
  code?: string
  message?: string
}

const parseResendErrorCode = (error: unknown): string => {
  if (error && typeof error === "object") {
    const { name, code, message } = error as ResendError
    for (const candidate of [code, name, message]) {
      if (
        candidate &&
        candidate !== "Error" &&
        /^[A-Za-z0-9_-]{2,64}$/.test(candidate)
      ) {
        return candidate
      }
    }
  }
  return "provider_error"
}
