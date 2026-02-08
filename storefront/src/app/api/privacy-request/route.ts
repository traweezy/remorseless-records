import { z } from "zod"

import { runtimeEnv } from "@/config/env"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiError,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

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

const backendBase = runtimeEnv.medusaBackendUrl ?? runtimeEnv.medusaUrl

export async function POST(request: Request) {
  try {
    const rateLimited = enforceRateLimit(request, {
      key: "api:privacy-request",
      max: 10,
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

    const response = await fetch(`${backendBase}/store/privacy-request`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-publishable-api-key": runtimeEnv.medusaPublishableKey,
      },
      body: JSON.stringify(parsed.data),
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { message?: string }
      return jsonApiResponse(
        { message: payload.message ?? "Unable to submit privacy request right now." },
        { status: 502 }
      )
    }

    return jsonApiResponse({ ok: true })
  } catch {
    console.error("[privacy-request] Failed to submit request")
    return jsonApiError("Unable to submit privacy request right now.", 500)
  }
}

