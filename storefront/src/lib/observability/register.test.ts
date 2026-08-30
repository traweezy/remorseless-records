import { beforeEach, describe, expect, it, vi } from "vitest"

const { registerOTelMock } = vi.hoisted(() => ({
  registerOTelMock: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@vercel/otel", () => ({
  registerOTel: registerOTelMock,
}))

import { StorefrontHttpCompletionProcessor } from "./request-completion"
import { registerStorefrontObservability } from "./register"

describe("Storefront OpenTelemetry registration", () => {
  beforeEach(() => {
    registerOTelMock.mockReset()
  })

  it("registers the bounded completion processor without broad auto-instrumentation", () => {
    registerStorefrontObservability()

    expect(registerOTelMock).toHaveBeenCalledTimes(1)
    expect(registerOTelMock).toHaveBeenCalledWith({
      instrumentations: [],
      serviceName: "storefront",
      spanProcessors: [expect.any(StorefrontHttpCompletionProcessor)],
      traceSampler: "parentbased_always_on",
    })
  })
})
