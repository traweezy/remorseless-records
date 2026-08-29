import "server-only"

import type { FetchArgs } from "@medusajs/js-sdk"

import { createUpstreamHeaders } from "@/lib/http/correlation"
import {
  createProviderSignal,
  toProviderRequestError,
} from "@/lib/http/provider-boundary"
import { medusa } from "@/lib/medusa/client"

export const correlatedMedusaFetch = async <T>(
  request: Request,
  path: string,
  init: FetchArgs = {}
): Promise<T> => {
  try {
    return await medusa.client.fetch<T>(path, {
      ...init,
      headers: Object.fromEntries(
        createUpstreamHeaders(request, init.headers as HeadersInit).entries()
      ),
      signal: createProviderSignal(init.signal),
    })
  } catch (error) {
    throw toProviderRequestError(error)
  }
}
