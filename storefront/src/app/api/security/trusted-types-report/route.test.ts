import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "./route"

const request = (
  payload: unknown,
  contentType = "application/csp-report"
): Request =>
  new Request("https://storefront.test/api/security/trusted-types-report", {
    body: JSON.stringify(payload),
    headers: {
      "content-type": contentType,
      "sec-fetch-site": "same-origin",
    },
    method: "POST",
  })

describe("Trusted Types report-only collector", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("accepts a legacy report without retaining report URLs or samples", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const response = await POST(
      request({
        "csp-report": {
          disposition: "report",
          "document-uri": "https://storefront.test/checkout?email=private",
          "effective-directive": "require-trusted-types-for",
          "script-sample": "private-customer-value",
        },
      })
    )

    expect(response.status).toBe(204)
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0")
    expect(log).toHaveBeenCalledOnce()
    const serialized = String(log.mock.calls[0]?.[0])
    expect(serialized).toContain(
      '"report_directive":"require-trusted-types-for"'
    )
    expect(serialized).toContain('"report_format":"legacy"')
    expect(serialized).not.toContain("checkout")
    expect(serialized).not.toContain("private")
  })

  it("accepts a bounded Reporting API batch", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const response = await POST(
      request(
        [
          {
            age: 0,
            body: {
              disposition: "report",
              effectiveDirective: "require-trusted-types-for",
            },
            type: "csp-violation",
            url: "https://storefront.test/catalog",
          },
        ],
        "application/reports+json"
      )
    )

    expect(response.status).toBe(204)
    const serialized = String(log.mock.calls[0]?.[0])
    expect(serialized).not.toContain("catalog")
  })

  it("rejects cross-site, unsupported, and customer-shaped reports", async () => {
    const crossSite = request({ "csp-report": {} })
    crossSite.headers.set("sec-fetch-site", "cross-site")
    await expect(POST(crossSite)).resolves.toHaveProperty("status", 403)

    await expect(
      POST(request({ "csp-report": {} }, "text/plain"))
    ).resolves.toHaveProperty("status", 415)

    await expect(
      POST(
        request({
          email: "private@example.test",
          "csp-report": {},
        })
      )
    ).resolves.toHaveProperty("status", 400)
  })

  it("rejects oversized payloads and Reporting API batches", async () => {
    await expect(
      POST(
        request({
          "csp-report": {
            "effective-directive": "require-trusted-types-for",
            padding: "x".repeat(8 * 1_024),
          },
        })
      )
    ).resolves.toHaveProperty("status", 413)

    const report = {
      body: {
        disposition: "report",
        effectiveDirective: "require-trusted-types-for",
      },
      type: "csp-violation",
    }
    await expect(
      POST(request(Array.from({ length: 21 }, () => report)))
    ).resolves.toHaveProperty("status", 400)
  })
})
