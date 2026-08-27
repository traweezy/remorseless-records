import "server-only"

import { z } from "zod"

import { createUpstreamHeaders } from "@/lib/http/correlation"
import { createPublicFormProof } from "@/lib/security/public-form-auth"
import {
  enforceRateLimit,
  enforceTrustedOrigin,
  jsonApiProblem,
  jsonApiResponse,
  parseJsonBody,
} from "@/lib/security/route-guards"

const schema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email(),
    reason: z.enum(["booking", "press", "collab", "other"]),
    message: z.string().trim().min(10).max(5000),
    honeypot: z.string().optional(),
  })
  .strict()

const FORM_BACKEND_TIMEOUT_MS = 8_000

type ContactPostDependencies = {
  backendBase: string
  fetchImpl: typeof fetch
  nowSeconds: () => number
  publishableKey: string
  secret: string | null
}

const isTimeoutError = (error: unknown): boolean => {
  if (!error || typeof error !== "object" || !("name" in error)) {
    return false
  }
  const { name } = error as { name?: unknown }
  return name === "TimeoutError" || name === "AbortError"
}

export const createContactPost =
  ({
    backendBase,
    fetchImpl,
    nowSeconds,
    publishableKey,
    secret,
  }: ContactPostDependencies) =>
  async (request: Request): Promise<Response> => {
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

    if (parsed.data.honeypot?.trim().length) {
      return jsonApiResponse({ ok: true })
    }

    const normalizedSecret = secret?.trim()
    if (!normalizedSecret || normalizedSecret.length < 32) {
      return jsonApiProblem({
        request,
        status: 503,
        code: "contact_unavailable",
        title: "Contact service is unavailable",
        detail: "Unable to send message right now.",
      })
    }

    const body = JSON.stringify(parsed.data)
    const timestamp = nowSeconds()
    const proof = createPublicFormProof({
      body,
      purpose: "contact",
      secret: normalizedSecret,
      timestamp,
    })

    let response: Response
    try {
      response = await fetchImpl(new URL("/store/contact", backendBase), {
        method: "POST",
        cache: "no-store",
        headers: createUpstreamHeaders(request, {
          "Content-Type": "application/json",
          "x-publishable-api-key": publishableKey,
          "x-rr-form-proof": proof,
          "x-rr-form-timestamp": String(timestamp),
        }),
        body,
        signal: AbortSignal.timeout(FORM_BACKEND_TIMEOUT_MS),
      })
    } catch (error) {
      if (isTimeoutError(error)) {
        return jsonApiProblem({
          request,
          status: 504,
          code: "contact_upstream_timeout",
          title: "Contact service timed out",
          detail: "Unable to send message right now.",
        })
      }
      console.error("[contact] Backend request failed")
      return jsonApiProblem({
        request,
        status: 502,
        code: "contact_upstream_unavailable",
        title: "Contact service is unavailable",
        detail: "Unable to send message right now.",
      })
    }

    if (!response.ok) {
      return jsonApiProblem({
        request,
        status: 502,
        code: "contact_upstream_unavailable",
        title: "Contact service is unavailable",
        detail: "Unable to send message right now.",
      })
    }

    return jsonApiResponse({ ok: true })
  }
