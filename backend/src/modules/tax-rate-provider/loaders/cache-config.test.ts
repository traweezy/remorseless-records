import type { Logger } from "@medusajs/framework/types"

import configureTaxCaches from "./cache-config"

describe("tax cache provider loader", () => {
  it("validates and reports bounded cache settings during startup", async () => {
    const info = jest.fn()

    await configureTaxCaches({
      container: {} as never,
      logger: { info } as unknown as Logger,
      moduleOptions: {},
      options: {
        rateCacheMaxEntries: 512,
        rateCacheTtlMs: 60_000,
        stripeQuoteCacheMaxEntries: 128,
        stripeQuoteTtlMs: 120_000,
      },
    })

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      "Tax local caches configured (rate_ttl_ms=60000, rate_max_entries=512, stripe_quote_ttl_ms=120000, stripe_quote_max_entries=128)."
    )
  })

  it("fails startup before logging invalid settings", async () => {
    const info = jest.fn()

    await expect(
      configureTaxCaches({
        container: {} as never,
        logger: { info } as unknown as Logger,
        moduleOptions: {},
        options: { rateCacheMaxEntries: 0 },
      })
    ).rejects.toThrow("TAX_RATE_LOOKUP_CACHE_MAX_ENTRIES")
    expect(info).not.toHaveBeenCalled()
  })
})
