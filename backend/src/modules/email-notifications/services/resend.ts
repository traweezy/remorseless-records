import { Logger, NotificationTypes } from "@medusajs/framework/types"
import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import { Resend, type CreateEmailOptions } from "resend"
import type { ReactElement } from "react"

import { observeOperation } from "../../../lib/observability/operation-telemetry"
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

type NotificationEmailOptions = Partial<
  Omit<CreateEmailOptions, "to" | "from" | "react" | "html">
>

export const RESEND_NOTIFICATION_TIMEOUT_MS = 5_000

const IDEMPOTENCY_REQUIRED_TEMPLATES = new Set<string>([
  EmailTemplates.ORDER_PLACED,
  EmailTemplates.REFUND_ISSUED,
])

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
    this.resendConfig = {
      apiKey: options.api_key,
      from: options.from,
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

    if (notification.channel === "sms") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "SMS notification not supported"
      )
    }

    const recipients = Array.isArray(notification.to)
      ? notification.to.filter((value): value is string => Boolean(value))
      : notification.to
        ? [notification.to]
        : []

    if (recipients.length === 0) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No destination email specified"
      )
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

      const message =
        error instanceof Error
          ? error.message
          : "Failed to render email template."

      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to generate email content for template "${notification.template}": ${message}`
      )
    }

    const emailOptions: NotificationEmailOptions =
      (notification.data?.emailOptions as
        NotificationEmailOptions | undefined) ?? {}

    const subject = emailOptions.subject?.trim()
    if (!subject) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Email notification must specify a subject"
      )
    }

    const providerIdempotencyKey = emailProviderIdempotencyKey(
      notification.provider_data
    )
    if (
      IDEMPOTENCY_REQUIRED_TEMPLATES.has(notification.template) &&
      !providerIdempotencyKey
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Email template "${notification.template}" requires provider idempotency.`
      )
    }

    const to: CreateEmailOptions["to"] =
      recipients.length === 1 ? recipients[0]! : recipients
    const attachments = mapAttachments(notification.attachments)

    const message: CreateEmailOptions = {
      to,
      from: notification.from?.trim() ?? this.resendConfig.from,
      react: emailContent,
      subject,
      ...(emailOptions.headers ? { headers: emailOptions.headers } : {}),
      ...(emailOptions.replyTo ? { replyTo: emailOptions.replyTo } : {}),
      ...(emailOptions.cc ? { cc: emailOptions.cc } : {}),
      ...(emailOptions.bcc ? { bcc: emailOptions.bcc } : {}),
      ...(emailOptions.tags ? { tags: emailOptions.tags } : {}),
      ...(emailOptions.text ? { text: emailOptions.text } : {}),
      ...(attachments ? { attachments } : {}),
      ...(emailOptions.scheduledAt
        ? { scheduledAt: emailOptions.scheduledAt }
        : {}),
    }

    try {
      const requestOptions = {
        ...(providerIdempotencyKey
          ? { idempotencyKey: providerIdempotencyKey }
          : {}),
        signal: AbortSignal.timeout(RESEND_NOTIFICATION_TIMEOUT_MS),
      }
      const result = await observeOperation(
        { domain: "email", operation: "send" },
        () => this.resendClient.emails.send(message, requestOptions)
      )
      if (result.error) {
        throw result.error
      }
      this.logger.info(
        `Sent "${notification.template}" email to ${recipients.length} recipient(s) via Resend`
      )
      return result.data?.id ? { id: result.data.id } : {}
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
}

const parseResendErrorCode = (error: unknown): string => {
  if (error && typeof error === "object") {
    const { name, code } = error as ResendError
    const candidate = code ?? name
    if (candidate && /^[A-Za-z0-9_-]{2,64}$/.test(candidate)) {
      return candidate
    }
  }
  return "provider_error"
}

const mapAttachments = (
  attachments: NotificationTypes.ProviderSendNotificationDTO["attachments"]
): NonNullable<CreateEmailOptions["attachments"]> | undefined => {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return undefined
  }

  return attachments.map((attachment) => ({
    content: attachment.content,
    filename: attachment.filename ?? undefined,
    contentType: attachment.content_type ?? undefined,
  })) as NonNullable<CreateEmailOptions["attachments"]>
}
