import { describe, expect, it } from "vitest"

import {
  hasRailwayProxyBoundary,
  resolveClientIp,
} from "@/lib/security/client-ip"

const railwayEnvironment = {
  RAILWAY_PROJECT_ID: "project-test",
  RAILWAY_ENVIRONMENT_ID: "environment-test",
  RAILWAY_SERVICE_ID: "service-test",
}

const createRequest = (headers: Record<string, string>): Request =>
  new Request("https://storefront.test/api/products", { headers })

describe("Storefront client IP boundary", () => {
  it("requires all Railway runtime identifiers", () => {
    expect(hasRailwayProxyBoundary(railwayEnvironment)).toBe(true)
    expect(
      hasRailwayProxyBoundary({
        RAILWAY_PROJECT_ID: "project-test",
        RAILWAY_ENVIRONMENT_ID: "environment-test",
      })
    ).toBe(false)
  })

  it("accepts Railway's documented client IP header at the boundary", () => {
    expect(
      resolveClientIp(
        createRequest({ "x-real-ip": "192.0.2.44" }),
        railwayEnvironment
      )
    ).toBe("192.0.2.44")
  })

  it("ignores forwarding and vendor headers without a trusted boundary", () => {
    expect(
      resolveClientIp(
        createRequest({
          "x-real-ip": "192.0.2.10",
          "x-forwarded-for": "192.0.2.11",
          "cf-connecting-ip": "192.0.2.12",
        }),
        {}
      )
    ).toBe("unknown")
  })

  it("rejects non-IP and legacy forwarded values at the Railway boundary", () => {
    expect(
      resolveClientIp(
        createRequest({
          "x-real-ip": "not-an-ip",
          "x-forwarded-for": "192.0.2.13",
          "cf-connecting-ip": "192.0.2.14",
        }),
        railwayEnvironment
      )
    ).toBe("unknown")
  })

  it("normalizes IPv4-mapped IPv6 addresses", () => {
    expect(
      resolveClientIp(
        createRequest({ "x-real-ip": "::ffff:192.0.2.15" }),
        railwayEnvironment
      )
    ).toBe("192.0.2.15")
  })
})
