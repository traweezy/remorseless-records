import * as React from 'react'
import type { ReactNode } from 'react'
import { MedusaError } from '@medusajs/framework/utils'
import { InviteUserEmail, INVITE_USER, isInviteUserData } from './invite-user'
import { OrderPlacedTemplate, ORDER_PLACED, isOrderPlacedTemplateData } from './order-placed'
import {
  isRefundIssuedTemplateData,
  RefundIssuedTemplate,
  REFUND_ISSUED,
} from './refund-issued'

export const EmailTemplates = {
  INVITE_USER,
  ORDER_PLACED,
  REFUND_ISSUED,
} as const

export type EmailTemplateType = keyof typeof EmailTemplates

export function generateEmailTemplate(templateKey: string, data: unknown): ReactNode {
  switch (templateKey) {
    case EmailTemplates.INVITE_USER:
      if (!isInviteUserData(data)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Invalid data for template "${EmailTemplates.INVITE_USER}"`
        )
      }
      return <InviteUserEmail {...data} />

    case EmailTemplates.ORDER_PLACED:
      if (!isOrderPlacedTemplateData(data)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Invalid data for template "${EmailTemplates.ORDER_PLACED}"`
        )
      }
      return <OrderPlacedTemplate {...data} />

    case EmailTemplates.REFUND_ISSUED:
      if (!isRefundIssuedTemplateData(data)) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `Invalid data for template "${EmailTemplates.REFUND_ISSUED}"`
        )
      }
      return <RefundIssuedTemplate {...data} />

    default:
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Unknown template key: "${templateKey}"`
      )
  }
}

export { InviteUserEmail, OrderPlacedTemplate, RefundIssuedTemplate }
