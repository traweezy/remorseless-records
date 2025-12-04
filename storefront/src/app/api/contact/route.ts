import { NextResponse } from "next/server"
import { z } from "zod"
import { Resend } from "resend"

import { siteMetadata } from "@/config/site"

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  reason: z.enum(["booking", "press", "collab", "other"]),
  message: z.string().trim().min(10).max(5000),
  honeypot: z.string().optional(),
})

const resendApiKey = process.env.RESEND_API_KEY
const resendFrom = process.env.RESEND_FROM ?? siteMetadata.contact.email

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { message: "Invalid request", errors: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    if (parsed.data.honeypot && parsed.data.honeypot.trim().length) {
      return NextResponse.json({ ok: true })
    }

    if (!resendApiKey) {
      return NextResponse.json(
        { message: "Email service is not configured. Please try again later." },
        { status: 503 }
      )
    }

    const resend = new Resend(resendApiKey)
    const { name, email, reason, message } = parsed.data

    await resend.emails.send({
      from: resendFrom,
      to: [siteMetadata.contact.email],
      replyTo: email,
      subject: `[Contact] ${reason.toUpperCase()}`,
      text: `From: ${name} <${email}>\nReason: ${reason}\n\n${message}`,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[contact] Failed to send message", error)
    return NextResponse.json({ message: "Unable to send message right now." }, { status: 500 })
  }
}
