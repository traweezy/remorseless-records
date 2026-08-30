import { hasRailwayProxyBoundary, resolveClientIp } from "./client-ip"

const railwayEnvironment = {
  RAILWAY_PROJECT_ID: "project-test",
  RAILWAY_ENVIRONMENT_ID: "environment-test",
  RAILWAY_SERVICE_ID: "service-test",
}

const createRequest = (
  headers: Record<string, string | string[] | undefined>,
  remoteAddress = "127.0.0.1"
) => ({
  headers,
  socket: { remoteAddress },
})

describe("Backend client IP boundary", () => {
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

  it("uses the direct peer and ignores forwarded headers off Railway", () => {
    expect(
      resolveClientIp(
        createRequest(
          {
            "x-real-ip": "192.0.2.10",
            "x-forwarded-for": "192.0.2.11",
          },
          "::ffff:192.0.2.12"
        ),
        {}
      )
    ).toBe("192.0.2.12")
  })

  it("rejects non-IP and legacy forwarded values at the boundary", () => {
    expect(
      resolveClientIp(
        createRequest({
          "x-real-ip": "not-an-ip",
          "x-forwarded-for": "192.0.2.13",
        }),
        railwayEnvironment
      )
    ).toBe("unknown")
  })

  it("rejects repeated client IP headers", () => {
    expect(
      resolveClientIp(
        createRequest({ "x-real-ip": ["192.0.2.14", "192.0.2.15"] }),
        railwayEnvironment
      )
    ).toBe("unknown")
  })
})
