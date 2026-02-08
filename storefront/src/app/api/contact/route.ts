import { z } from "zod"

import { runtimeEnv } from "@/config/env"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email(),
  reason: z.enum(["booking", "press", "collab", "other"]),
  message: z.string().trim().min(10).max(5000),
  honeypot: z.string().optional(),
}).strict()

const backendBase = runtimeEnv.medusaBackendUrl ?? runtimeEnv.medusaUrl

export async function POST(request: Request) {
  try {
    const rateLimited = enforceRateLimit(request, {
      key: "api:contact",
      max: 15,
      windowMs: 60_000,
    })
    if (rateLimited) {
      return rateLimited
    }

    const originCheck = enforceTrustedOrigin(request)
    if (originCheck) {
      return originCheck
    }

    const parsed = await parseJsonBody(request, schema, {
      maxBytes: 16 * 1024,
    })
    if (!parsed.ok) {
      return parsed.response
    }

    if (parsed.data.honeypot && parsed.data.honeypot.trim().length) {
      return jsonApiResponse({ ok: true })
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
      return jsonApiResponse(
        { message: payload.message ?? "Unable to send message right now." },
        { status: 502 }
      )
    }

    return jsonApiResponse({ ok: true })
  } catch {
    console.error("[contact] Failed to send message")
    return jsonApiError("Unable to send message right now.", 500)
  }
}
