import "server-only"

import type { FetchArgs } from "@medusajs/js-sdk"

import { createUpstreamHeaders } from "@/lib/http/correlation"
import { medusa } from "@/lib/medusa/client"

export const correlatedMedusaFetch = <T>(
  request: Request,
  path: string,
  init: FetchArgs = {}
): Promise<T> =>
  medusa.client.fetch<T>(path, {
    ...init,
    headers: Object.fromEntries(
      createUpstreamHeaders(request, init.headers as HeadersInit).entries()
    ),
  })
