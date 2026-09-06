import "server-only"

import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core"
import {
  defaultResource,
  detectResources,
  envDetector,
  resourceFromAttributes,
} from "@opentelemetry/resources"
import {
  AlwaysOnSampler,
  ParentBasedSampler,
} from "@opentelemetry/sdk-trace-base"
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"

import { StorefrontHttpCompletionProcessor } from "./request-completion"

const PROVIDER_SYMBOL = Symbol.for(
  "com.remorselessrecords.storefront.observability-provider.v1"
)
const providerGlobal = globalThis as typeof globalThis & {
  [key: symbol]: unknown
}

const createPropagator = (value: string | undefined): CompositePropagator => {
  const requested = (value ?? "")
    .split(",")
    .map((choice) => choice.trim())
    .filter(Boolean)
  const selected = new Set<"tracecontext" | "baggage">()
  for (const choice of requested.length ? requested : ["auto"]) {
    switch (choice) {
      case "none":
        break
      case "auto":
        selected.add("tracecontext")
        selected.add("baggage")
        break
      case "tracecontext":
      case "baggage":
        selected.add(choice)
        break
      default:
        throw new Error("Unsupported OpenTelemetry propagator configuration")
    }
  }
  return new CompositePropagator({
    propagators: [...selected].map((choice) =>
      choice === "tracecontext"
        ? new W3CTraceContextPropagator()
        : new W3CBaggagePropagator()
    ),
  })
}

export const registerStorefrontObservability = (): void => {
  if (
    providerGlobal[PROVIDER_SYMBOL] ||
    process.env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true"
  ) {
    return
  }

  const propagator = createPropagator(process.env.OTEL_PROPAGATORS)
  const provider = new NodeTracerProvider({
    resource: defaultResource()
      .merge(resourceFromAttributes({ "service.name": "storefront" }))
      .merge(detectResources({ detectors: [envDetector] })),
    sampler: new ParentBasedSampler({ root: new AlwaysOnSampler() }),
    // A long-lived server must let every request end its own span, even when
    // sibling requests share a trace. Do not force-close spans by trace ID.
    spanProcessors: [new StorefrontHttpCompletionProcessor()],
  })
  // Only the requested W3C propagation and default AsyncLocalStorage are
  // installed; no automatic instrumentations, exporters, or network readers.
  provider.register({ propagator })
  providerGlobal[PROVIDER_SYMBOL] = provider
}
