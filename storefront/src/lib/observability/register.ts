import "server-only"

import { registerOTel } from "@vercel/otel"

import { StorefrontHttpCompletionProcessor } from "./request-completion"

export const registerStorefrontObservability = (): void => {
  registerOTel({
    instrumentations: [],
    serviceName: "storefront",
    spanProcessors: [new StorefrontHttpCompletionProcessor()],
    traceSampler: "parentbased_always_on",
  })
}
