import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { Resend } from "resend"
import { z } from "zod"
import { randomUUID } from "node:crypto"

import { RESEND_API_KEY, RESEND_FROM_EMAIL } from "../../../lib/constants"

const schema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    requestType: z.enum(["access", "delete", "correct", "optout", "other"]),
    details: z.string().trim().min(10).max(5000),
    orderId: z.string().trim().max(120).optional(),
    honeypot: z.string().optional(),
  })
  .strict()

export const POST = async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "Resend is not configured on the backend"
    )
  }

  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      JSON.stringify(parsed.error.flatten().fieldErrors)
    )
  }

  if (parsed.data.honeypot && parsed.data.honeypot.trim().length) {
    res.status(200).json({ ok: true })
    return
  }

  const requestId = randomUUID()
  const timestamp = new Date().toISOString()
  const { name, email, requestType, details, orderId } = parsed.data
  const orderLine = orderId?.trim().length ? `Order ID: ${orderId}` : "Order ID: (not provided)"

  const resend = new Resend(RESEND_API_KEY)
  await resend.emails.send({
    from: RESEND_FROM_EMAIL,
    to: [RESEND_FROM_EMAIL],
    replyTo: email,
    subject: `[Privacy Request] ${requestType.toUpperCase()} (${requestId})`,
    text: [
      `Request ID: ${requestId}`,
      `Submitted At (UTC): ${timestamp}`,
      `Name: ${name}`,
      `Email: ${email}`,
      `Type: ${requestType}`,
      orderLine,
      "",
      "Details:",
      details,
    ].join("\n"),
  })

  res.status(200).json({ ok: true, request_id: requestId })
}
