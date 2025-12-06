import { NextResponse } from "next/server"
import { z } from "zod"

import { runtimeEnv } from "@/config/env"
import { safeLogError } from "@/lib/logging"

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  reason: z.enum(["booking", "press", "collab", "other"]),
  message: z.string().trim().min(10).max(5000),
  honeypot: z.string().optional(),
})

const backendBase = runtimeEnv.medusaBackendUrl ?? runtimeEnv.medusaUrl

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
      `${backendBase}/store/contact`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-publishable-api-key": runtimeEnv.medusaPublishableKey,
        },
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
    safeLogError("[contact] Failed to send message", error)
    return NextResponse.json({ message: "Unable to send message right now." }, { status: 500 })
  }
}
