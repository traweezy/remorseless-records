import {
  operationsAppRoutePaths,
  replaceLegacyOperationsLocation,
  replaceLegacyTaxControlLocation,
  taxControlAppRoutePath,
} from "./operations-routes"

describe("operations Admin routes", () => {
  it.each([
    ["tax-records", "/app/operations/tax-records"],
    ["refunds", "/app/operations/refunds"],
    ["media-cleanup", "/app/operations/media-cleanup"],
  ] as const)(
    "replaces the legacy %s route without adding a history entry",
    (workspace, expected) => {
      const replace = jest.fn()

      replaceLegacyOperationsLocation({ replace }, workspace)

      expect(operationsAppRoutePaths[workspace]).toBe(expected)
      expect(replace).toHaveBeenCalledWith(expected)
    }
  )

  it("moves Tax control into native Admin settings", () => {
    const replace = jest.fn()

    replaceLegacyTaxControlLocation({ replace })

    expect(taxControlAppRoutePath).toBe("/app/settings/tax-control")
    expect(replace).toHaveBeenCalledWith(taxControlAppRoutePath)
  })
})
