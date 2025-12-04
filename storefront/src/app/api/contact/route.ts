import { NextResponse } from "next/server"
import { z } from "zod"

import { backendBaseUrl, withBackendHeaders } from "@/config/backend"

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  reason: z.enum(["booking", "press", "collab", "other"]),
  message: z.string().trim().min(10).max(5000),
  honeypot: z.string().optional(),
})

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

    const response = await fetch(
      `${backendBaseUrl}/store/contact`,
      {
        method: "POST",
        headers: withBackendHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(parsed.data),
      }
    )

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { message?: string }
      return NextResponse.json(
        { message: payload.message ?? "Unable to send message right now." },
        { status: 502 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[contact] Failed to send message", error)
    return NextResponse.json({ message: "Unable to send message right now." }, { status: 500 })
  }
}
