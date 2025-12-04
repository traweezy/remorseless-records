import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { Resend } from "resend"
import { z } from "zod"

import { RESEND_API_KEY, RESEND_FROM_EMAIL } from "../../../lib/constants"

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  reason: z.enum(["booking", "press", "collab", "other"]),
  message: z.string().trim().min(10).max(5000),
  honeypot: z.string().optional(),
})

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

  const resend = new Resend(RESEND_API_KEY)
  const { name, email, reason, message } = parsed.data

  await resend.emails.send({
    from: RESEND_FROM_EMAIL,
    to: [RESEND_FROM_EMAIL],
    replyTo: email,
    subject: `[Contact] ${reason.toUpperCase()}`,
    text: `From: ${name} <${email}>\nReason: ${reason}\n\n${message}`,
  })

  res.status(200).json({ ok: true })
}
