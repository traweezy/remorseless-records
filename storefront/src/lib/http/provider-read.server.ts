import "server-only"

import {
  fetchProviderRead,
  type ProviderReadOptions,
} from "@/lib/http/provider-boundary"
import { recordStorefrontProviderMetric } from "@/lib/observability/metrics"

type ObservedProviderReadOptions = Omit<ProviderReadOptions, "recordMetric">

export const fetchObservedProviderRead = (
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: ObservedProviderReadOptions = {}
): Promise<Response> =>
  fetchProviderRead(input, init, {
    ...options,
    recordMetric: recordStorefrontProviderMetric,
  })
